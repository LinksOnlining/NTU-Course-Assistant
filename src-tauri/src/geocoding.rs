use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use reqwest::{Client, StatusCode, Url};
use serde_json::{json, Map, Value};
use tauri::State;

const PHOTON_BASE_URL: &str = "https://photon.komoot.io/";
const NOMINATIM_BASE_URL: &str = "https://nominatim.openstreetmap.org/";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_CACHE_ENTRIES: usize = 64;
const NOMINATIM_INTERVAL: Duration = Duration::from_secs(1);
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone)]
struct Endpoints {
    photon: Url,
    nominatim: Url,
}

#[derive(Clone)]
struct CacheEntry {
    stored_at: Instant,
    response: Value,
}

#[derive(Default)]
struct RuntimeCache {
    entries: HashMap<String, CacheEntry>,
    next_nominatim_slot: Option<Instant>,
}

pub struct GeocodingState {
    client: Client,
    endpoints: Endpoints,
    cache: Mutex<RuntimeCache>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProviderError {
    InvalidRequest,
    Unavailable,
}

impl GeocodingState {
    pub fn new() -> Result<Self, reqwest::Error> {
        Self::with_config(PHOTON_BASE_URL, NOMINATIM_BASE_URL, REQUEST_TIMEOUT)
    }

    fn with_config(
        photon_base: &str,
        nominatim_base: &str,
        timeout: Duration,
    ) -> Result<Self, reqwest::Error> {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let endpoints = Endpoints {
            photon: Url::parse(photon_base).expect("valid Photon endpoint"),
            nominatim: Url::parse(nominatim_base).expect("valid Nominatim endpoint"),
        };
        let client = Client::builder()
            .timeout(timeout)
            .user_agent(concat!(
                "LinksWorkplace/",
                env!("CARGO_PKG_VERSION"),
                " (+https://github.com/LinksOnlining/NTU-Course-Assistant)"
            ))
            .build()?;

        Ok(Self {
            client,
            endpoints,
            cache: Mutex::new(RuntimeCache::default()),
        })
    }

    fn cache_get(&self, key: &str) -> Option<Value> {
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        cache
            .entries
            .retain(|_, entry| now.duration_since(entry.stored_at) <= CACHE_TTL);
        cache.entries.get(key).map(|entry| entry.response.clone())
    }

    fn cache_put(&self, key: String, response: Value) {
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        cache
            .entries
            .retain(|_, entry| now.duration_since(entry.stored_at) <= CACHE_TTL);
        if cache.entries.len() >= MAX_CACHE_ENTRIES {
            if let Some(oldest) = cache
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.stored_at)
                .map(|(key, _)| key.clone())
            {
                cache.entries.remove(&oldest);
            }
        }
        cache.entries.insert(
            key,
            CacheEntry {
                stored_at: now,
                response,
            },
        );
    }

    fn reserve_nominatim_slot(&self) -> Duration {
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        let scheduled = cache.next_nominatim_slot.unwrap_or(now).max(now);
        cache.next_nominatim_slot = Some(scheduled + NOMINATIM_INTERVAL);
        scheduled.saturating_duration_since(now)
    }

    async fn send_json(
        &self,
        provider: &'static str,
        operation: &'static str,
        request: reqwest::RequestBuilder,
    ) -> Result<Value, ProviderError> {
        let started = Instant::now();
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                let failure = if error.is_timeout() {
                    "timeout"
                } else {
                    "network"
                };
                trace_provider(
                    provider,
                    operation,
                    "none",
                    "unknown",
                    started.elapsed(),
                    failure,
                    None,
                );
                return Err(ProviderError::Unavailable);
            }
        };

        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("unknown")
            .to_string();
        if !status.is_success() {
            let error = if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                ProviderError::Unavailable
            } else if status.is_client_error() {
                ProviderError::InvalidRequest
            } else {
                ProviderError::Unavailable
            };
            trace_provider(
                provider,
                operation,
                &status.to_string(),
                &content_type,
                started.elapsed(),
                if error == ProviderError::InvalidRequest {
                    "invalid_provider_request"
                } else {
                    "provider_unavailable"
                },
                None,
            );
            return Err(error);
        }

        let bytes = match response.bytes().await {
            Ok(bytes) if bytes.len() <= MAX_RESPONSE_BYTES => bytes,
            _ => {
                trace_provider(
                    provider,
                    operation,
                    &status.to_string(),
                    &content_type,
                    started.elapsed(),
                    "malformed_response",
                    None,
                );
                return Err(ProviderError::Unavailable);
            }
        };
        let value = match serde_json::from_slice::<Value>(&bytes) {
            Ok(value) => value,
            Err(_) => {
                trace_provider(
                    provider,
                    operation,
                    &status.to_string(),
                    &content_type,
                    started.elapsed(),
                    "malformed_response",
                    None,
                );
                return Err(ProviderError::Unavailable);
            }
        };

        trace_provider(
            provider,
            operation,
            &status.to_string(),
            &content_type,
            started.elapsed(),
            "ok",
            value
                .get("features")
                .and_then(Value::as_array)
                .map(Vec::len),
        );
        Ok(value)
    }

    async fn photon_forward(&self, query: &str) -> Result<Value, ProviderError> {
        let url = self
            .endpoints
            .photon
            .join("api")
            .map_err(|_| ProviderError::InvalidRequest)?;
        let value = self
            .send_json(
                "photon",
                "forward",
                self.client
                    .get(url)
                    .query(&[("q", query), ("lang", "default"), ("limit", "12")]),
            )
            .await?;
        validate_feature_collection(value)
    }

    async fn photon_reverse(&self, latitude: f64, longitude: f64) -> Result<Value, ProviderError> {
        let url = self
            .endpoints
            .photon
            .join("reverse")
            .map_err(|_| ProviderError::InvalidRequest)?;
        let value = self
            .send_json(
                "photon",
                "reverse",
                self.client.get(url).query(&[
                    ("lat", latitude.to_string()),
                    ("lon", longitude.to_string()),
                    ("lang", "default".to_string()),
                ]),
            )
            .await?;
        let collection = validate_feature_collection(value)?;
        if collection["features"].as_array().is_some_and(Vec::is_empty) {
            return Err(ProviderError::Unavailable);
        }
        Ok(collection)
    }

    async fn nominatim_forward(&self, query: &str) -> Result<Value, ProviderError> {
        let wait = self.reserve_nominatim_slot();
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        let url = self
            .endpoints
            .nominatim
            .join("search")
            .map_err(|_| ProviderError::InvalidRequest)?;
        let value = self
            .send_json(
                "nominatim",
                "forward",
                self.client.get(url).query(&[
                    ("q", query),
                    ("format", "jsonv2"),
                    ("addressdetails", "1"),
                    ("limit", "10"),
                    ("accept-language", "zh-CN"),
                ]),
            )
            .await?;
        let Some(items) = value.as_array() else {
            return Err(ProviderError::Unavailable);
        };
        let features = items
            .iter()
            .filter_map(|item| nominatim_feature(item, false))
            .collect::<Vec<_>>();
        if !items.is_empty() && features.is_empty() {
            return Err(ProviderError::Unavailable);
        }
        Ok(json!({"type":"FeatureCollection","features":features}))
    }

    async fn nominatim_reverse(
        &self,
        latitude: f64,
        longitude: f64,
    ) -> Result<Value, ProviderError> {
        let wait = self.reserve_nominatim_slot();
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        let url = self
            .endpoints
            .nominatim
            .join("reverse")
            .map_err(|_| ProviderError::InvalidRequest)?;
        let value = self
            .send_json(
                "nominatim",
                "reverse",
                self.client.get(url).query(&[
                    ("lat", latitude.to_string()),
                    ("lon", longitude.to_string()),
                    ("format", "jsonv2".to_string()),
                    ("addressdetails", "1".to_string()),
                    ("zoom", "18".to_string()),
                    ("accept-language", "zh-CN".to_string()),
                ]),
            )
            .await?;
        let features = nominatim_feature(&value, true)
            .into_iter()
            .collect::<Vec<_>>();
        Ok(json!({"type":"FeatureCollection","features":features}))
    }

    async fn search(&self, query: String) -> Result<Value, ProviderError> {
        let query = query.trim();
        if query.is_empty() || query.chars().count() > 160 {
            return Err(ProviderError::InvalidRequest);
        }
        let cache_key = format!("forward:{}", query.to_lowercase());
        if let Some(value) = self.cache_get(&cache_key) {
            return Ok(value);
        }

        let value = match self.photon_forward(query).await {
            Ok(value) => value,
            Err(ProviderError::InvalidRequest) => return Err(ProviderError::InvalidRequest),
            Err(ProviderError::Unavailable) => self.nominatim_forward(query).await?,
        };
        self.cache_put(cache_key, value.clone());
        Ok(value)
    }

    async fn reverse(&self, latitude: f64, longitude: f64) -> Result<Value, ProviderError> {
        if !latitude.is_finite()
            || !(-90.0..=90.0).contains(&latitude)
            || !longitude.is_finite()
            || !(-180.0..=180.0).contains(&longitude)
        {
            return Err(ProviderError::InvalidRequest);
        }
        let latitude = round_coordinate(latitude);
        let longitude = round_coordinate(longitude);
        let cache_key = format!("reverse:{latitude:.3},{longitude:.3}");
        if let Some(value) = self.cache_get(&cache_key) {
            return Ok(value);
        }

        let value = match self.photon_reverse(latitude, longitude).await {
            Ok(value) => value,
            Err(ProviderError::InvalidRequest) => return Err(ProviderError::InvalidRequest),
            Err(ProviderError::Unavailable) => self.nominatim_reverse(latitude, longitude).await?,
        };
        self.cache_put(cache_key, value.clone());
        Ok(value)
    }

    fn command_error(error: ProviderError, reverse: bool) -> String {
        match error {
            ProviderError::InvalidRequest => "invalidProviderRequest".into(),
            ProviderError::Unavailable if reverse => "reverseGeocodingUnavailable".into(),
            ProviderError::Unavailable => "geocodingUnavailable".into(),
        }
    }
}

#[tauri::command]
pub async fn search_weather_location(
    state: State<'_, GeocodingState>,
    query: String,
) -> Result<Value, String> {
    state
        .search(query)
        .await
        .map_err(|error| GeocodingState::command_error(error, false))
}

#[tauri::command]
pub async fn reverse_geocode_weather_location(
    state: State<'_, GeocodingState>,
    latitude: f64,
    longitude: f64,
) -> Result<Value, String> {
    state
        .reverse(latitude, longitude)
        .await
        .map_err(|error| GeocodingState::command_error(error, true))
}

fn validate_feature_collection(value: Value) -> Result<Value, ProviderError> {
    let Some(features) = value.get("features").and_then(Value::as_array) else {
        return Err(ProviderError::Unavailable);
    };
    if features.is_empty() {
        return Ok(json!({"type":"FeatureCollection","features":[]}));
    }
    if !features.iter().any(valid_feature) {
        return Err(ProviderError::Unavailable);
    }
    Ok(value)
}

fn valid_feature(feature: &Value) -> bool {
    let Some(properties) = feature.get("properties").and_then(Value::as_object) else {
        return false;
    };
    let Some(coordinates) = feature
        .get("geometry")
        .and_then(|geometry| geometry.get("coordinates"))
        .and_then(Value::as_array)
    else {
        return false;
    };
    let (Some(longitude), Some(latitude)) = (
        coordinates.first().and_then(Value::as_f64),
        coordinates.get(1).and_then(Value::as_f64),
    ) else {
        return false;
    };
    let has_name = [
        "name", "street", "locality", "district", "city", "county", "state", "country",
    ]
    .iter()
    .any(|field| {
        properties
            .get(*field)
            .and_then(Value::as_str)
            .is_some_and(|v| !v.trim().is_empty())
    });
    has_name && (-180.0..=180.0).contains(&longitude) && (-90.0..=90.0).contains(&latitude)
}

fn nominatim_feature(value: &Value, reverse: bool) -> Option<Value> {
    let longitude = value.get("lon").and_then(parse_coordinate)?;
    let latitude = value.get("lat").and_then(parse_coordinate)?;
    if !(-180.0..=180.0).contains(&longitude) || !(-90.0..=90.0).contains(&latitude) {
        return None;
    }
    let address = value.get("address").and_then(Value::as_object);
    let state = address.and_then(|a| first_text(a, &["state", "province", "region"]));
    let city = address.and_then(|a| first_text(a, &["city", "town", "municipality", "village"]));
    let county = address.and_then(|a| first_text(a, &["county"]));
    let district =
        address.and_then(|a| first_text(a, &["city_district", "suburb", "district", "borough"]));
    let locality =
        address.and_then(|a| first_text(a, &["neighbourhood", "quarter", "hamlet", "locality"]));
    let street = if reverse {
        None
    } else {
        address.and_then(|a| first_text(a, &["road", "pedestrian", "cycleway"]))
    };
    let country = address.and_then(|a| first_text(a, &["country"]));
    let named_place = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let display_name = named_place
        .or(street.as_deref())
        .or(locality.as_deref())
        .or(district.as_deref())
        .or(city.as_deref())
        .or(county.as_deref())
        .or(state.as_deref())
        .or(country.as_deref())?;
    let precision = if street.is_some() {
        "street"
    } else if locality.is_some() {
        "locality"
    } else if district.is_some() {
        "district"
    } else if city.is_some() {
        "city"
    } else if county.is_some() {
        "county"
    } else if state.is_some() {
        "state"
    } else if country.is_some() {
        "country"
    } else {
        "other"
    };

    let mut properties = Map::new();
    properties.insert("name".into(), json!(display_name));
    properties.insert("type".into(), json!(precision));
    for (key, item) in [
        ("state", state),
        ("city", city),
        ("county", county),
        ("district", district),
        ("locality", locality),
        ("street", street),
        ("country", country),
    ] {
        if let Some(item) = item {
            properties.insert(key.into(), json!(item));
        }
    }
    if let Some(kind) = value.get("osm_type").and_then(Value::as_str) {
        properties.insert("osm_type".into(), json!(kind));
    }
    if let Some(id) = value.get("osm_id") {
        if id.is_number() || id.as_str().is_some() {
            properties.insert("osm_id".into(), id.clone());
        }
    }

    Some(json!({
        "type":"Feature",
        "geometry":{"type":"Point","coordinates":[longitude,latitude]},
        "properties":properties,
    }))
}

fn first_text(address: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| address.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn parse_coordinate(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.parse().ok())
}

fn round_coordinate(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

#[cfg(debug_assertions)]
fn trace_provider(
    provider: &str,
    operation: &str,
    status: &str,
    content_type: &str,
    elapsed: Duration,
    result: &str,
    count: Option<usize>,
) {
    eprintln!(
        "[geocoding] provider={provider} operation={operation} status={status} content_type={content_type} elapsed_ms={} result={result} result_count={}",
        elapsed.as_millis(),
        count.map_or_else(|| "n/a".to_owned(), |value| value.to_string())
    );
}

#[cfg(not(debug_assertions))]
fn trace_provider(
    _provider: &str,
    _operation: &str,
    _status: &str,
    _content_type: &str,
    _elapsed: Duration,
    _result: &str,
    _count: Option<usize>,
) {
}

#[cfg(test)]
mod tests {
    use super::{GeocodingState, ProviderError};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    fn mock_once(response: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 8192];
            let count = stream.read(&mut request).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&request[..count]).into_owned()
        });
        (format!("http://{address}/"), handle)
    }

    fn response(status: &str, body: &str) -> &'static str {
        Box::leak(
            format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        )
    }

    fn service(photon: &str, nominatim: &str, timeout: Duration) -> GeocodingState {
        GeocodingState::with_config(photon, nominatim, timeout).unwrap()
    }

    fn feature_collection(name: &str) -> String {
        format!(
            r#"{{"type":"FeatureCollection","features":[{{"type":"Feature","geometry":{{"type":"Point","coordinates":[13.377704,52.516275]}},"properties":{{"name":"{name}","type":"city"}}}}]}}"#
        )
    }

    #[test]
    fn photon_forward_uses_supported_default_language_and_returns_valid_results() {
        let photon_response = response("200 OK", &feature_collection("Berlin"));
        let (photon, request) = mock_once(photon_response);
        let nominatim = "http://127.0.0.1:1/";
        let state = service(&photon, nominatim, Duration::from_secs(1));

        let result = tauri::async_runtime::block_on(state.search("Berlin".into())).unwrap();
        let request = request.join().unwrap();
        assert!(request.starts_with("GET /api?q=Berlin&lang=default&limit=12 "));
        assert!(result["features"][0]["properties"]["name"] == "Berlin");
    }

    #[test]
    fn photon_empty_results_are_not_misreported_as_network_errors_or_fallbacks() {
        let (photon, request) = mock_once(response(
            "200 OK",
            r#"{"type":"FeatureCollection","features":[]}"#,
        ));
        let nominatim = "http://127.0.0.1:1/";
        let state = service(&photon, nominatim, Duration::from_secs(1));

        let result = tauri::async_runtime::block_on(state.search("不存在地点".into())).unwrap();
        assert!(result["features"].as_array().unwrap().is_empty());
        assert!(request.join().unwrap().starts_with("GET /api?"));
    }

    #[test]
    fn successful_queries_are_cached_in_memory() {
        let (photon, request) = mock_once(response("200 OK", &feature_collection("Berlin")));
        let state = service(&photon, "http://127.0.0.1:1/", Duration::from_secs(1));
        let first = tauri::async_runtime::block_on(state.search(" Berlin ".into())).unwrap();
        let second = tauri::async_runtime::block_on(state.search("berlin".into())).unwrap();
        assert_eq!(first, second);
        assert!(request.join().unwrap().starts_with("GET /api?q=Berlin&"));
    }

    #[test]
    fn nominatim_reservations_are_spaced_at_the_policy_limit() {
        let state = service(
            "http://127.0.0.1:1/",
            "http://127.0.0.1:1/",
            Duration::from_secs(1),
        );
        let _first = state.reserve_nominatim_slot();
        let second = state.reserve_nominatim_slot();
        assert!(second >= Duration::from_millis(990));
    }

    #[test]
    fn photon_400_is_invalid_request_and_does_not_trigger_fallback() {
        let (photon, request) =
            mock_once(response("400 Bad Request", r#"{"lang":["unsupported"]}"#));
        let nominatim = "http://127.0.0.1:1/";
        let state = service(&photon, nominatim, Duration::from_secs(1));

        let result = tauri::async_runtime::block_on(state.search("南通大学".into()));
        assert_eq!(result.unwrap_err(), ProviderError::InvalidRequest);
        assert!(request.join().unwrap().starts_with("GET /api?"));
    }

    #[test]
    fn photon_server_failure_falls_back_to_nominatim_with_identifying_user_agent() {
        let (photon, request) = mock_once(response("503 Service Unavailable", "{}"));
        let nominatim_response = response(
            "200 OK",
            r#"[{"lat":"52.516275","lon":"13.377704","name":"Berlin","osm_type":"relation","osm_id":1,"display_name":"Private full address must not escape","address":{"city":"Berlin","state":"Berlin","country":"Germany","postcode":"10117"}}]"#,
        );
        let (nominatim, fallback_request) = mock_once(nominatim_response);
        let state = service(&photon, &nominatim, Duration::from_secs(1));

        let result = tauri::async_runtime::block_on(state.search("Berlin".into())).unwrap();
        let request = request.join().unwrap();
        let fallback_request = fallback_request.join().unwrap();
        assert!(request.starts_with("GET /api?"));
        assert!(fallback_request.starts_with("GET /search?q=Berlin&format=jsonv2"));
        assert!(fallback_request
            .to_lowercase()
            .contains("user-agent: linksworkplace/1.3.1"));
        assert_eq!(result["features"][0]["properties"]["name"], "Berlin");
        let output = result.to_string();
        assert!(!output.contains("Private full address must not escape"));
        assert!(!output.contains("postcode"));
    }

    #[test]
    fn photon_timeout_falls_back_to_nominatim() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let photon = format!("http://{}/", listener.local_addr().unwrap());
        let stalled_server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            thread::sleep(Duration::from_millis(150));
        });
        let (nominatim, fallback_request) = mock_once(response("200 OK", "[]"));
        let state = service(&photon, &nominatim, Duration::from_millis(40));

        let result = tauri::async_runtime::block_on(state.search("Berlin".into())).unwrap();
        assert!(result["features"].as_array().unwrap().is_empty());
        assert!(fallback_request
            .join()
            .unwrap()
            .starts_with("GET /search?q=Berlin"));
        stalled_server.join().unwrap();
    }

    #[test]
    fn malformed_photon_response_falls_back_and_fallback_failure_is_bounded() {
        let (photon, _request) = mock_once(response("200 OK", "not-json"));
        let (nominatim, _fallback) = mock_once(response("503 Service Unavailable", "{}"));
        let state = service(&photon, &nominatim, Duration::from_secs(1));
        let error = tauri::async_runtime::block_on(state.search("南通大学".into())).unwrap_err();
        assert_eq!(
            GeocodingState::command_error(error, false),
            "geocodingUnavailable"
        );
    }

    #[test]
    fn reverse_rounds_coordinates_and_uses_fallback_after_an_empty_photon_result() {
        let (photon, request) = mock_once(response(
            "200 OK",
            r#"{"type":"FeatureCollection","features":[]}"#,
        ));
        let reverse_body = r#"{"lat":"52.516","lon":"13.378","name":"Brandenburg Gate","osm_type":"way","osm_id":1,"address":{"city":"Berlin","state":"Berlin","country":"Germany","road":"Private street"}}"#;
        let (nominatim, fallback_request) = mock_once(response("200 OK", reverse_body));
        let state = service(&photon, &nominatim, Duration::from_secs(1));

        let result = tauri::async_runtime::block_on(state.reverse(52.516275, 13.377704)).unwrap();
        let request = request.join().unwrap();
        let fallback_request = fallback_request.join().unwrap();
        assert!(request.contains("lat=52.516&lon=13.378&lang=default"));
        assert!(fallback_request.starts_with("GET /reverse?lat=52.516&lon=13.378"));
        assert_eq!(
            result["features"][0]["properties"]["name"],
            "Brandenburg Gate"
        );
        assert!(!result.to_string().contains("Private street"));
    }
}

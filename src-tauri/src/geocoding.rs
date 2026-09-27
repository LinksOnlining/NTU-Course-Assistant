use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use reqwest::{Client, StatusCode, Url};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::secure_credentials;

const AMAP_BASE_URL: &str = "https://restapi.amap.com/";
const BAIDU_BASE_URL: &str = "https://api.map.baidu.com/";
const WEATHER_CREDENTIAL_SERVICE: &str = "links-workplace.weather";
const AMAP_ACCOUNT: &str = "amap.web-service";
const BAIDU_ACCOUNT: &str = "baidu.web-service";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_CACHE_ENTRIES: usize = 64;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_MAP_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESULTS: usize = 12;

#[derive(Clone)]
struct Endpoints {
    amap: Url,
    baidu: Url,
}

#[derive(Clone)]
struct CacheEntry {
    stored_at: Instant,
    locations: Vec<ResolvedLocation>,
}

#[derive(Default)]
struct RuntimeCache {
    search: HashMap<String, CacheEntry>,
}

#[derive(Default)]
struct SearchCancellation {
    searches: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

pub struct GeocodingState {
    client: Client,
    endpoints: Endpoints,
    cache: Mutex<RuntimeCache>,
    cancellation: SearchCancellation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProviderError {
    InvalidRequest,
    NotConfigured,
    Unauthorized,
    RateLimited,
    Unavailable,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLocation {
    pub display_name: String,
    pub display_address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub coordinate_system: &'static str,
    pub timezone: Option<String>,
    pub country: Option<String>,
    pub admin1: Option<String>,
    pub admin2: Option<String>,
    pub admin3: Option<String>,
    pub admin4: Option<String>,
    pub county: Option<String>,
    pub street: Option<String>,
    pub provider: String,
    pub provider_id: Option<String>,
    #[serde(rename = "type")]
    pub location_type: String,
    pub precision: String,
    pub source: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QueryIntent {
    FullAddress,
    Administrative,
    Poi,
    General,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AmapStrategy {
    District,
    Tips,
    Poi,
    Geocode,
}

#[derive(Clone, Debug)]
struct BaiduCandidate {
    raw: Value,
    longitude: f64,
    latitude: f64,
    is_geocode: bool,
}

#[derive(Clone, Debug, Default)]
struct AdminFields {
    admin1: Option<String>,
    admin2: Option<String>,
    admin3: Option<String>,
    admin4: Option<String>,
    county: Option<String>,
}

struct LocationMetadata {
    admin: AdminFields,
    street: Option<String>,
    provider: String,
    provider_id: Option<String>,
    location_type: String,
    precision: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherCredentialStatus {
    pub amap_configured: bool,
    pub baidu_configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherMapImage {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

impl GeocodingState {
    pub fn new() -> Result<Self, reqwest::Error> {
        Self::with_config(AMAP_BASE_URL, BAIDU_BASE_URL, REQUEST_TIMEOUT)
    }

    fn with_config(
        amap_base: &str,
        baidu_base: &str,
        timeout: Duration,
    ) -> Result<Self, reqwest::Error> {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let endpoints = Endpoints {
            amap: Url::parse(amap_base).expect("valid AMap endpoint"),
            baidu: Url::parse(baidu_base).expect("valid Baidu endpoint"),
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
            cancellation: SearchCancellation::default(),
        })
    }

    fn cache_get(&self, key: &str) -> Option<Vec<ResolvedLocation>> {
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        cache
            .search
            .retain(|_, entry| now.duration_since(entry.stored_at) <= CACHE_TTL);
        cache.search.get(key).map(|entry| entry.locations.clone())
    }

    fn cache_put(&self, key: String, locations: Vec<ResolvedLocation>) {
        let now = Instant::now();
        let mut cache = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        cache
            .search
            .retain(|_, entry| now.duration_since(entry.stored_at) <= CACHE_TTL);
        if cache.search.len() >= MAX_CACHE_ENTRIES {
            if let Some(oldest) = cache
                .search
                .iter()
                .min_by_key(|(_, entry)| entry.stored_at)
                .map(|(key, _)| key.clone())
            {
                cache.search.remove(&oldest);
            }
        }
        cache.search.insert(
            key,
            CacheEntry {
                stored_at: now,
                locations,
            },
        );
    }

    fn clear_cache(&self) {
        self.cache
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .search
            .clear();
    }

    fn register_search(&self, request_id: &str) -> Arc<AtomicBool> {
        let cancellation = Arc::new(AtomicBool::new(false));
        self.cancellation
            .searches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(request_id.to_owned(), Arc::clone(&cancellation));
        cancellation
    }

    fn finish_search(&self, request_id: &str, cancellation: &Arc<AtomicBool>) {
        let mut searches = self
            .cancellation
            .searches
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if searches
            .get(request_id)
            .is_some_and(|active| Arc::ptr_eq(active, cancellation))
        {
            searches.remove(request_id);
        }
    }

    fn cancel_search(&self, request_id: &str) {
        if let Some(cancellation) = self
            .cancellation
            .searches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(request_id)
        {
            cancellation.store(true, Ordering::Relaxed);
        }
    }

    fn is_cancelled(cancellation: &AtomicBool) -> bool {
        cancellation.load(Ordering::Relaxed)
    }

    async fn get_json(
        &self,
        provider: &'static str,
        operation: &'static str,
        url: Url,
        query: &[(String, String)],
    ) -> Result<Value, ProviderError> {
        let started = Instant::now();
        let response = match self.client.get(url).query(query).send().await {
            Ok(response) => response,
            Err(error) => {
                trace_provider(
                    provider,
                    operation,
                    "network_or_timeout",
                    started.elapsed(),
                    "unavailable",
                    None,
                );
                let _ = error;
                return Err(ProviderError::Unavailable);
            }
        };
        let status = response.status();
        if !status.is_success() {
            let error = if status == StatusCode::TOO_MANY_REQUESTS {
                ProviderError::RateLimited
            } else if status.is_client_error() {
                ProviderError::Unauthorized
            } else {
                ProviderError::Unavailable
            };
            trace_provider(
                provider,
                operation,
                &status.to_string(),
                started.elapsed(),
                "http_error",
                None,
            );
            return Err(error);
        }
        let bytes = read_limited(response, MAX_RESPONSE_BYTES).await?;
        let value =
            serde_json::from_slice::<Value>(&bytes).map_err(|_| ProviderError::Unavailable)?;
        trace_provider(
            provider,
            operation,
            &status.to_string(),
            started.elapsed(),
            "ok",
            None,
        );
        Ok(value)
    }

    async fn amap_json(
        &self,
        path: &str,
        params: Vec<(String, String)>,
        key: &str,
        operation: &'static str,
    ) -> Result<Value, ProviderError> {
        let url = self
            .endpoints
            .amap
            .join(path)
            .map_err(|_| ProviderError::Unavailable)?;
        let mut params = params;
        params.push(("key".into(), key.to_owned()));
        let value = self.get_json("amap", operation, url, &params).await?;
        match value.get("status").and_then(Value::as_str) {
            Some("1") => Ok(value),
            _ => Err(amap_error(&value)),
        }
    }

    async fn amap_strategy(
        &self,
        strategy: AmapStrategy,
        query: &str,
        key: &str,
    ) -> Result<Vec<ResolvedLocation>, ProviderError> {
        match strategy {
            AmapStrategy::Tips => {
                let value = self
                    .amap_json(
                        "v3/assistant/inputtips",
                        vec![
                            ("keywords".into(), query.to_owned()),
                            ("datatype".into(), "all".into()),
                        ],
                        key,
                        "input_tips",
                    )
                    .await?;
                Ok(value
                    .get("tips")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|tip| amap_tip(tip, query))
                    .collect())
            }
            AmapStrategy::Poi => {
                let value = self
                    .amap_json(
                        "v3/place/text",
                        vec![
                            ("keywords".into(), query.to_owned()),
                            ("citylimit".into(), "false".into()),
                            ("offset".into(), "15".into()),
                            ("page".into(), "1".into()),
                            ("extensions".into(), "all".into()),
                        ],
                        key,
                        "poi_search",
                    )
                    .await?;
                Ok(value
                    .get("pois")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|poi| amap_poi(poi, query))
                    .collect())
            }
            AmapStrategy::Geocode => {
                let value = self
                    .amap_json(
                        "v3/geocode/geo",
                        vec![("address".into(), query.to_owned())],
                        key,
                        "geocode",
                    )
                    .await?;
                Ok(value
                    .get("geocodes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|item| amap_geocode(item, query))
                    .collect())
            }
            AmapStrategy::District => {
                let value = self
                    .amap_json(
                        "v3/config/district",
                        vec![
                            ("keywords".into(), query.to_owned()),
                            ("subdistrict".into(), "3".into()),
                            ("extensions".into(), "base".into()),
                        ],
                        key,
                        "district_search",
                    )
                    .await?;
                let mut results = Vec::new();
                let roots = value.get("districts").and_then(Value::as_array);
                if let Some(roots) = roots {
                    for root in roots {
                        collect_amap_districts(root, &[], query, &mut results);
                    }
                }
                Ok(results)
            }
        }
    }

    async fn baidu_json(
        &self,
        path: &str,
        params: Vec<(String, String)>,
        key: &str,
        operation: &'static str,
    ) -> Result<Value, ProviderError> {
        let url = self
            .endpoints
            .baidu
            .join(path)
            .map_err(|_| ProviderError::Unavailable)?;
        let mut params = params;
        params.push(("ak".into(), key.to_owned()));
        let value = self.get_json("baidu", operation, url, &params).await?;
        match value.get("status").and_then(Value::as_u64) {
            Some(0) => Ok(value),
            Some(302) | Some(401) | Some(402) => Err(ProviderError::Unauthorized),
            Some(4) | Some(5) => Err(ProviderError::RateLimited),
            _ => Err(ProviderError::Unavailable),
        }
    }

    async fn baidu_candidates(
        &self,
        query: &str,
        key: &str,
        intent: QueryIntent,
        cancellation: &AtomicBool,
    ) -> Result<Vec<BaiduCandidate>, ProviderError> {
        if Self::is_cancelled(cancellation) {
            return Err(ProviderError::Cancelled);
        }
        if intent == QueryIntent::FullAddress {
            let result = self
                .baidu_json(
                    "geocoding/v3/",
                    vec![
                        ("address".into(), query.to_owned()),
                        ("output".into(), "json".into()),
                    ],
                    key,
                    "geocode",
                )
                .await;
            if Self::is_cancelled(cancellation) {
                return Err(ProviderError::Cancelled);
            }
            if let Ok(value) = result {
                if let Some(candidate) = baidu_geocode_candidate(&value) {
                    return Ok(vec![candidate]);
                }
            }
        }

        if Self::is_cancelled(cancellation) {
            return Err(ProviderError::Cancelled);
        }
        match self
            .baidu_json(
                "place/v3/search",
                vec![
                    ("query".into(), query.to_owned()),
                    ("region".into(), "全国".into()),
                    ("region_limit".into(), "false".into()),
                    ("output".into(), "json".into()),
                    ("scope".into(), "2".into()),
                    ("page_size".into(), "15".into()),
                ],
                key,
                "place_search",
            )
            .await
        {
            Ok(value) => Ok(value
                .get("results")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(baidu_place_candidate)
                .collect()),
            Err(error) => Err(error),
        }
    }

    async fn convert_baidu_candidates(
        &self,
        candidates: Vec<BaiduCandidate>,
        key: &str,
        query: &str,
    ) -> Result<Vec<ResolvedLocation>, ProviderError> {
        if candidates.is_empty() {
            return Ok(Vec::new());
        }
        let coordinates = candidates
            .iter()
            .map(|candidate| format!("{:.6},{:.6}", candidate.longitude, candidate.latitude))
            .collect::<Vec<_>>()
            .join(";");
        let converted = self
            .baidu_json(
                "geoconv/v2/",
                vec![
                    ("coords".into(), coordinates),
                    ("model".into(), "5".into()),
                    ("output".into(), "json".into()),
                ],
                key,
                "coordinate_conversion",
            )
            .await?;
        let Some(points) = converted.get("result").and_then(Value::as_array) else {
            return Err(ProviderError::Unavailable);
        };
        Ok(candidates
            .iter()
            .zip(points)
            .filter_map(|(candidate, point)| {
                let longitude = number(point.get("x"))?;
                let latitude = number(point.get("y"))?;
                if !valid_coordinates(latitude, longitude) {
                    return None;
                }
                let mut location = if candidate.is_geocode {
                    map_baidu_geocode(&candidate.raw, latitude, longitude, query)
                } else {
                    map_baidu_place(&candidate.raw, latitude, longitude, query)
                }?;
                location.latitude = latitude;
                location.longitude = longitude;
                Some(location)
            })
            .collect())
    }

    async fn search_with_keys(
        &self,
        query: &str,
        admin_hint: Option<&str>,
        amap_key: Option<&str>,
        baidu_key: Option<&str>,
        cancellation: &AtomicBool,
    ) -> Result<Vec<ResolvedLocation>, ProviderError> {
        let query = validate_query(query)?;
        let hint = validate_hint(admin_hint)?;
        if amap_key.is_none() && baidu_key.is_none() {
            return Err(ProviderError::NotConfigured);
        }
        let cache_key = format!(
            "{}|{}",
            normalize_text(query),
            hint.map(normalize_text).unwrap_or_default()
        );
        if let Some(cached) = self.cache_get(&cache_key) {
            return Ok(cached);
        }
        if Self::is_cancelled(cancellation) {
            return Err(ProviderError::Cancelled);
        }

        let intent = classify_query(query);
        let mut results = Vec::new();
        let mut provider_error = None;
        if let Some(key) = amap_key {
            let strategies = amap_strategies(intent);
            for strategy in strategies.iter().take(2) {
                if Self::is_cancelled(cancellation) {
                    return Err(ProviderError::Cancelled);
                }
                match self.amap_strategy(*strategy, query, key).await {
                    Ok(locations) => results.extend(locations),
                    Err(ProviderError::InvalidRequest) => {
                        return Err(ProviderError::InvalidRequest)
                    }
                    Err(error) => provider_error = Some(error),
                }
            }
            if let Some(hint) = hint.filter(|hint| !hint.is_empty()) {
                if let Some(strategy) = strategies.first() {
                    if Self::is_cancelled(cancellation) {
                        return Err(ProviderError::Cancelled);
                    }
                    let enriched = format!("{hint} {query}");
                    if normalize_text(&enriched) != normalize_text(query) {
                        match self.amap_strategy(*strategy, &enriched, key).await {
                            Ok(locations) => results.extend(locations),
                            Err(error) => provider_error = Some(error),
                        }
                    }
                }
            }
        }

        let mut normalized = rank_and_deduplicate(results, query, hint);
        if normalized.is_empty() {
            if let Some(key) = baidu_key {
                if Self::is_cancelled(cancellation) {
                    return Err(ProviderError::Cancelled);
                }
                let candidates = self
                    .baidu_candidates(query, key, intent, cancellation)
                    .await;
                let mut fallback = match candidates {
                    Ok(candidates) => {
                        match self.convert_baidu_candidates(candidates, key, query).await {
                            Ok(locations) => locations,
                            Err(error) => {
                                provider_error = Some(error);
                                Vec::new()
                            }
                        }
                    }
                    Err(ProviderError::Cancelled) => return Err(ProviderError::Cancelled),
                    Err(error) => {
                        provider_error = Some(error);
                        Vec::new()
                    }
                };
                if fallback.is_empty() && intent != QueryIntent::FullAddress {
                    if let Some(hint) = hint.filter(|value| !value.is_empty()) {
                        if Self::is_cancelled(cancellation) {
                            return Err(ProviderError::Cancelled);
                        }
                        let enriched = format!("{hint} {query}");
                        let candidates = self
                            .baidu_candidates(&enriched, key, QueryIntent::Poi, cancellation)
                            .await;
                        match candidates {
                            Ok(candidates) => {
                                match self.convert_baidu_candidates(candidates, key, query).await {
                                    Ok(locations) => fallback = locations,
                                    Err(error) => provider_error = Some(error),
                                }
                            }
                            Err(ProviderError::Cancelled) => return Err(ProviderError::Cancelled),
                            Err(error) => provider_error = Some(error),
                        }
                    }
                }
                normalized = rank_and_deduplicate(fallback, query, hint);
            }
        }
        if Self::is_cancelled(cancellation) {
            return Err(ProviderError::Cancelled);
        }
        if normalized.is_empty() {
            if let Some(error) = provider_error {
                return Err(error);
            }
        }
        normalized.truncate(MAX_RESULTS);
        self.cache_put(cache_key, normalized.clone());
        Ok(normalized)
    }

    async fn reverse_with_keys(
        &self,
        latitude: f64,
        longitude: f64,
        amap_key: Option<&str>,
        baidu_key: Option<&str>,
    ) -> Result<Option<ResolvedLocation>, ProviderError> {
        if !valid_coordinates(latitude, longitude) {
            return Err(ProviderError::InvalidRequest);
        }
        if let Some(key) = amap_key {
            let params = vec![
                ("location".into(), format!("{longitude:.6},{latitude:.6}")),
                ("extensions".into(), "base".into()),
            ];
            if let Ok(value) = self
                .amap_json("v3/geocode/regeo", params, key, "reverse_geocode")
                .await
            {
                if let Some(location) = map_amap_reverse(&value, latitude, longitude) {
                    return Ok(Some(location));
                }
            }
        }
        if let Some(key) = baidu_key {
            let params = vec![
                ("location".into(), format!("{latitude:.6},{longitude:.6}")),
                ("coordtype".into(), "gcj02ll".into()),
                ("output".into(), "json".into()),
            ];
            if let Ok(value) = self
                .baidu_json("reverse_geocoding/v3/", params, key, "reverse_geocode")
                .await
            {
                if let Some(location) = map_baidu_reverse(&value, latitude, longitude) {
                    return Ok(Some(location));
                }
            }
        }
        Ok(None)
    }

    async fn map_image(
        &self,
        latitude: f64,
        longitude: f64,
        zoom: u8,
        key: &str,
    ) -> Result<WeatherMapImage, ProviderError> {
        if !valid_coordinates(latitude, longitude) || !(1..=17).contains(&zoom) {
            return Err(ProviderError::InvalidRequest);
        }
        let url = self
            .endpoints
            .amap
            .join("v3/staticmap")
            .map_err(|_| ProviderError::Unavailable)?;
        let started = Instant::now();
        let response = self
            .client
            .get(url)
            .query(&[
                ("location", format!("{longitude:.6},{latitude:.6}")),
                ("zoom", zoom.to_string()),
                ("size", "640*420".into()),
                ("scale", "1".into()),
                ("key", key.to_owned()),
            ])
            .send()
            .await
            .map_err(|_| ProviderError::Unavailable)?;
        if !response.status().is_success() {
            let status = response.status();
            let error = if status == StatusCode::TOO_MANY_REQUESTS {
                ProviderError::RateLimited
            } else if status.is_client_error() {
                ProviderError::Unauthorized
            } else {
                ProviderError::Unavailable
            };
            trace_provider(
                "amap",
                "static_map",
                &status.to_string(),
                started.elapsed(),
                "http_error",
                None,
            );
            return Err(error);
        }
        let mime_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if mime_type != "image/png" && mime_type != "image/jpeg" {
            let body = read_limited(response, MAX_RESPONSE_BYTES).await?;
            let error = serde_json::from_slice::<Value>(&body)
                .map(|value| amap_error(&value))
                .unwrap_or(ProviderError::Unavailable);
            trace_provider(
                "amap",
                "static_map",
                "200",
                started.elapsed(),
                "invalid_content_type",
                None,
            );
            return Err(error);
        }
        let image = read_limited(response, MAX_MAP_BYTES).await?;
        if image.is_empty()
            || image.len() > MAX_MAP_BYTES
            || !(image.starts_with(b"\x89PNG\r\n\x1a\n") || image.starts_with(b"\xff\xd8\xff"))
        {
            trace_provider(
                "amap",
                "static_map",
                "200",
                started.elapsed(),
                "invalid_image",
                None,
            );
            return Err(ProviderError::Unavailable);
        }
        trace_provider("amap", "static_map", "200", started.elapsed(), "ok", None);
        Ok(WeatherMapImage {
            mime_type,
            bytes: image,
        })
    }

    fn command_error(error: ProviderError) -> String {
        match error {
            ProviderError::InvalidRequest => "invalidProviderRequest".into(),
            ProviderError::NotConfigured => "locationProvidersNotConfigured".into(),
            ProviderError::Unauthorized => "weatherCredentialUnavailable".into(),
            ProviderError::RateLimited => "locationProviderRateLimited".into(),
            ProviderError::Unavailable => "locationProvidersUnavailable".into(),
            ProviderError::Cancelled => "cancelled".into(),
        }
    }
}

async fn read_limited(
    mut response: reqwest::Response,
    maximum_bytes: usize,
) -> Result<Vec<u8>, ProviderError> {
    if response
        .content_length()
        .is_some_and(|length| length > maximum_bytes as u64)
    {
        return Err(ProviderError::Unavailable);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ProviderError::Unavailable)?
    {
        if bytes.len().saturating_add(chunk.len()) > maximum_bytes {
            return Err(ProviderError::Unavailable);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn search_weather_location(
    state: State<'_, GeocodingState>,
    query: String,
    admin_hint: Option<String>,
    request_id: String,
) -> Result<Vec<ResolvedLocation>, String> {
    let amap_key = credential(AMAP_ACCOUNT).map_err(|_| "credentialStoreUnavailable".to_owned())?;
    let baidu_key =
        credential(BAIDU_ACCOUNT).map_err(|_| "credentialStoreUnavailable".to_owned())?;
    let cancellation = state.register_search(&request_id);
    let result = state
        .search_with_keys(
            &query,
            admin_hint.as_deref(),
            amap_key.as_deref(),
            baidu_key.as_deref(),
            &cancellation,
        )
        .await
        .map_err(GeocodingState::command_error);
    state.finish_search(&request_id, &cancellation);
    result
}

#[tauri::command]
pub async fn cancel_weather_location_search(
    state: State<'_, GeocodingState>,
    request_id: String,
) -> Result<(), String> {
    state.cancel_search(&request_id);
    Ok(())
}

#[tauri::command]
pub async fn reverse_geocode_weather_location(
    state: State<'_, GeocodingState>,
    latitude: f64,
    longitude: f64,
) -> Result<Option<ResolvedLocation>, String> {
    let amap_key = credential(AMAP_ACCOUNT).map_err(|_| "credentialStoreUnavailable".to_owned())?;
    let baidu_key =
        credential(BAIDU_ACCOUNT).map_err(|_| "credentialStoreUnavailable".to_owned())?;
    state
        .reverse_with_keys(
            latitude,
            longitude,
            amap_key.as_deref(),
            baidu_key.as_deref(),
        )
        .await
        .map_err(GeocodingState::command_error)
}

#[tauri::command]
pub async fn get_weather_map_image(
    state: State<'_, GeocodingState>,
    latitude: f64,
    longitude: f64,
    zoom: u8,
) -> Result<WeatherMapImage, String> {
    let key = credential(AMAP_ACCOUNT)
        .map_err(|_| "credentialStoreUnavailable".to_owned())?
        .ok_or_else(|| "mapUnavailable".to_owned())?;
    state
        .map_image(latitude, longitude, zoom, &key)
        .await
        .map_err(GeocodingState::command_error)
}

#[tauri::command]
pub fn get_weather_credential_status() -> Result<WeatherCredentialStatus, String> {
    let amap_configured = credential(AMAP_ACCOUNT)
        .map_err(|_| "credentialStoreUnavailable".to_owned())?
        .is_some_and(|key| !key.trim().is_empty());
    let baidu_configured = credential(BAIDU_ACCOUNT)
        .map_err(|_| "credentialStoreUnavailable".to_owned())?
        .is_some_and(|key| !key.trim().is_empty());
    Ok(WeatherCredentialStatus {
        amap_configured,
        baidu_configured,
    })
}

#[tauri::command]
pub fn set_weather_provider_key(
    state: State<'_, GeocodingState>,
    provider: String,
    key: String,
) -> Result<bool, String> {
    let account =
        credential_account(&provider).ok_or_else(|| "invalidProviderRequest".to_owned())?;
    let key = key.trim();
    if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("invalidProviderRequest".into());
    }
    secure_credentials::set(WEATHER_CREDENTIAL_SERVICE, account, key)
        .map_err(|_| "credentialStoreUnavailable".to_owned())?;
    state.clear_cache();
    Ok(true)
}

#[tauri::command]
pub fn delete_weather_provider_key(
    state: State<'_, GeocodingState>,
    provider: String,
) -> Result<bool, String> {
    let account =
        credential_account(&provider).ok_or_else(|| "invalidProviderRequest".to_owned())?;
    secure_credentials::delete(WEATHER_CREDENTIAL_SERVICE, account)
        .map_err(|_| "credentialStoreUnavailable".to_owned())?;
    state.clear_cache();
    Ok(true)
}

fn credential(account: &str) -> Result<Option<String>, secure_credentials::CredentialError> {
    secure_credentials::get(WEATHER_CREDENTIAL_SERVICE, account)
}

fn credential_account(provider: &str) -> Option<&'static str> {
    match provider {
        "amap" => Some(AMAP_ACCOUNT),
        "baidu" => Some(BAIDU_ACCOUNT),
        _ => None,
    }
}

fn validate_query(query: &str) -> Result<&str, ProviderError> {
    let query = query.trim();
    if query.chars().count() < 2
        || query.chars().count() > 160
        || query.chars().any(char::is_control)
    {
        return Err(ProviderError::InvalidRequest);
    }
    Ok(query)
}

fn validate_hint(hint: Option<&str>) -> Result<Option<&str>, ProviderError> {
    let Some(hint) = hint.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if hint.chars().count() > 80 || hint.chars().any(char::is_control) {
        return Err(ProviderError::InvalidRequest);
    }
    Ok(Some(hint))
}

fn classify_query(query: &str) -> QueryIntent {
    let contains_address_number = query.chars().any(|character| character.is_ascii_digit())
        && ["号", "弄", "组", "室", "单元"]
            .iter()
            .any(|suffix| query.contains(suffix));
    let admin_count = ["省", "市", "区", "县", "镇", "乡", "街道", "旗"]
        .iter()
        .filter(|token| query.contains(**token))
        .count();
    if contains_address_number || (admin_count >= 3 && query.chars().count() >= 8) {
        return QueryIntent::FullAddress;
    }
    if [
        "学校",
        "小学",
        "中学",
        "大学",
        "村委会",
        "社区",
        "医院",
        "公园",
        "景点",
        "小区",
    ]
    .iter()
    .any(|token| query.contains(token))
    {
        return QueryIntent::Poi;
    }
    if admin_count > 0 || query.contains("行政村") || query.contains("自然村") {
        return QueryIntent::Administrative;
    }
    QueryIntent::General
}

fn amap_strategies(intent: QueryIntent) -> &'static [AmapStrategy] {
    match intent {
        QueryIntent::FullAddress => &[AmapStrategy::Geocode, AmapStrategy::Tips, AmapStrategy::Poi],
        QueryIntent::Administrative => &[
            AmapStrategy::District,
            AmapStrategy::Geocode,
            AmapStrategy::Tips,
        ],
        QueryIntent::Poi => &[AmapStrategy::Tips, AmapStrategy::Poi, AmapStrategy::Geocode],
        QueryIntent::General => &[AmapStrategy::Tips, AmapStrategy::Poi, AmapStrategy::Geocode],
    }
}

fn amap_error(value: &Value) -> ProviderError {
    let code = value
        .get("infocode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match code {
        "10001" | "10002" | "10007" | "10008" => ProviderError::Unauthorized,
        "10003" | "10004" | "10044" => ProviderError::RateLimited,
        _ => ProviderError::Unavailable,
    }
}

fn normalize_text(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace() && !"，,。.;；、·-_/".contains(*character))
        .flat_map(char::to_lowercase)
        .collect()
}

fn amap_tip(value: &Value, _query: &str) -> Option<ResolvedLocation> {
    let name = text(value.get("name"))?;
    let (longitude, latitude) = coordinate_pair(value.get("location")?.as_str()?)?;
    let district = text(value.get("district"));
    let admin = admin_fields(district.as_deref());
    let location_type = classify_provider_type(value.get("type").and_then(Value::as_str));
    let precision = precision_for_type(&location_type).to_owned();
    let address = sanitize_address(text(value.get("address")).unwrap_or_default());
    Some(make_location(
        name,
        join_address(&[
            admin.admin1.as_deref(),
            admin.admin2.as_deref(),
            admin.admin3.as_deref(),
            admin.admin4.as_deref(),
            Some(&address),
        ]),
        latitude,
        longitude,
        LocationMetadata {
            admin,
            street: None,
            provider: "amap".into(),
            provider_id: text(value.get("id")),
            location_type,
            precision,
        },
    ))
}

fn amap_poi(value: &Value, _query: &str) -> Option<ResolvedLocation> {
    let name = text(value.get("name"))?;
    let (longitude, latitude) = coordinate_pair(value.get("location")?.as_str()?)?;
    let district = text(value.get("pname"))
        .into_iter()
        .chain(text(value.get("cityname")))
        .chain(text(value.get("adname")))
        .collect::<Vec<_>>()
        .join("");
    let hierarchy = if district.is_empty() {
        text(value.get("district"))
    } else {
        Some(district)
    };
    let admin = admin_fields(hierarchy.as_deref());
    let location_type = classify_provider_type(value.get("type").and_then(Value::as_str));
    let precision = precision_for_type(&location_type).to_owned();
    let street = text(value.get("address")).map(sanitize_address);
    Some(make_location(
        name,
        join_address(&[
            admin.admin1.as_deref(),
            admin.admin2.as_deref(),
            admin.admin3.as_deref(),
            admin.admin4.as_deref(),
            street.as_deref(),
        ]),
        latitude,
        longitude,
        LocationMetadata {
            admin,
            street,
            provider: "amap".into(),
            provider_id: text(value.get("id")),
            location_type,
            precision,
        },
    ))
}

fn amap_geocode(value: &Value, _query: &str) -> Option<ResolvedLocation> {
    let name = text(value.get("formatted_address")).or_else(|| text(value.get("level")))?;
    let (longitude, latitude) = coordinate_pair(value.get("location")?.as_str()?)?;
    let province = text(value.get("province"));
    let city = text(value.get("city"));
    let district = text(value.get("district"));
    let township = text(value.get("township"));
    let admin1 = province;
    let admin2 = city;
    let admin3 = district.clone();
    let admin4 = township;
    let mut county = None;
    if district
        .as_deref()
        .is_some_and(|value| value.ends_with('县'))
    {
        county = district;
    }
    let location_type = if admin4.is_some() {
        "街镇"
    } else if admin3.is_some() {
        "行政区"
    } else {
        "地址"
    }
    .to_owned();
    let precision = if admin4.is_some() {
        "locality"
    } else if admin3.is_some() {
        "district"
    } else {
        "street"
    }
    .to_owned();
    let admin = AdminFields {
        admin1,
        admin2,
        admin3,
        admin4,
        county,
    };
    Some(make_location(
        name.clone(),
        join_address(&[
            admin.admin1.as_deref(),
            admin.admin2.as_deref(),
            admin.admin3.as_deref(),
            admin.admin4.as_deref(),
            Some(&sanitize_address(name)),
        ]),
        latitude,
        longitude,
        LocationMetadata {
            admin,
            street: None,
            provider: "amap".into(),
            provider_id: text(value.get("adcode")),
            location_type,
            precision,
        },
    ))
}

fn collect_amap_districts(
    district: &Value,
    ancestors: &[String],
    query: &str,
    output: &mut Vec<ResolvedLocation>,
) {
    if output.len() >= MAX_RESULTS * 2 {
        return;
    }
    let Some(name) = text(district.get("name")) else {
        return;
    };
    let mut hierarchy = ancestors.to_vec();
    hierarchy.push(name.clone());
    let matches = normalize_text(&name) == normalize_text(query)
        || normalize_text(query).contains(&normalize_text(&name));
    if matches {
        if let Some((longitude, latitude)) = district
            .get("center")
            .and_then(Value::as_str)
            .and_then(coordinate_pair)
        {
            let level = text(district.get("level")).unwrap_or_else(|| "district".into());
            let admin = hierarchy_fields(&hierarchy);
            let location_type = match level.as_str() {
                "street" => "街镇",
                "city" => "城市",
                "province" => "省级行政区",
                _ => "行政区",
            }
            .to_owned();
            let precision = match level.as_str() {
                "street" => "locality",
                "city" => "city",
                "province" => "state",
                _ => "district",
            }
            .to_owned();
            output.push(make_location(
                name.clone(),
                hierarchy.join(" · "),
                latitude,
                longitude,
                LocationMetadata {
                    admin,
                    street: None,
                    provider: "amap".into(),
                    provider_id: text(district.get("adcode")),
                    location_type,
                    precision,
                },
            ));
        }
    }
    if let Some(children) = district.get("districts").and_then(Value::as_array) {
        for child in children {
            collect_amap_districts(child, &hierarchy, query, output);
        }
    }
}

fn baidu_place_candidate(value: &Value) -> Option<BaiduCandidate> {
    let location = value.get("location")?;
    Some(BaiduCandidate {
        raw: value.clone(),
        longitude: number(location.get("lng"))?,
        latitude: number(location.get("lat"))?,
        is_geocode: false,
    })
}

fn baidu_geocode_candidate(value: &Value) -> Option<BaiduCandidate> {
    let result = value.get("result")?;
    let location = result.get("location")?;
    Some(BaiduCandidate {
        raw: result.clone(),
        longitude: number(location.get("lng"))?,
        latitude: number(location.get("lat"))?,
        is_geocode: true,
    })
}

fn map_baidu_place(
    value: &Value,
    latitude: f64,
    longitude: f64,
    _query: &str,
) -> Option<ResolvedLocation> {
    let name = text(value.get("name"))?;
    let province = text(value.get("province"));
    let city = text(value.get("city"));
    let area = text(value.get("area"));
    let town = text(value.get("town"));
    let address = sanitize_address(text(value.get("address")).unwrap_or_default());
    let admin = AdminFields {
        admin1: province,
        admin2: city,
        admin3: area.clone(),
        admin4: town,
        county: area.filter(|value| value.ends_with('县')),
    };
    let details = value.get("detail_info");
    let location_type = classify_provider_type(
        details
            .and_then(|item| item.get("tag"))
            .and_then(Value::as_str)
            .or_else(|| value.get("type").and_then(Value::as_str)),
    );
    let precision = precision_for_type(&location_type).to_owned();
    Some(make_location(
        name,
        join_address(&[
            admin.admin1.as_deref(),
            admin.admin2.as_deref(),
            admin.admin3.as_deref(),
            admin.admin4.as_deref(),
            Some(&address),
        ]),
        latitude,
        longitude,
        LocationMetadata {
            admin,
            street: Some(address),
            provider: "baidu".into(),
            provider_id: text(value.get("uid")),
            location_type,
            precision,
        },
    ))
}

fn map_baidu_geocode(
    value: &Value,
    latitude: f64,
    longitude: f64,
    query: &str,
) -> Option<ResolvedLocation> {
    let name = text(value.get("formatted_address")).unwrap_or_else(|| query.to_owned());
    let component = value.get("addressComponent");
    let admin1 = text(component?.get("province"));
    let admin2 = text(component?.get("city"));
    let admin3 = text(component?.get("district"));
    let admin4 = text(component?.get("town"));
    let county = admin3.clone().filter(|value| value.ends_with('县'));
    let address = sanitize_address(name.clone());
    let location_type = if admin4.is_some() { "街镇" } else { "地址" }.to_owned();
    let precision = if admin4.is_some() {
        "locality"
    } else {
        "street"
    }
    .to_owned();
    let admin = AdminFields {
        admin1,
        admin2,
        admin3,
        admin4,
        county,
    };
    Some(make_location(
        name,
        join_address(&[
            admin.admin1.as_deref(),
            admin.admin2.as_deref(),
            admin.admin3.as_deref(),
            admin.admin4.as_deref(),
            Some(&address),
        ]),
        latitude,
        longitude,
        LocationMetadata {
            admin,
            street: None,
            provider: "baidu".into(),
            provider_id: None,
            location_type,
            precision,
        },
    ))
}

fn map_amap_reverse(value: &Value, latitude: f64, longitude: f64) -> Option<ResolvedLocation> {
    let regeocode = value.get("regeocode")?;
    let component = regeocode.get("addressComponent");
    let admin1 = text(component?.get("province"));
    let admin2 = text(component?.get("city")).filter(|value| !value.is_empty());
    let admin3 = text(component?.get("district")).filter(|value| !value.is_empty());
    let admin4 = text(component?.get("township")).filter(|value| !value.is_empty());
    let county = admin3.clone().filter(|value| value.ends_with('县'));
    let name = admin4
        .clone()
        .or_else(|| admin3.clone())
        .or_else(|| admin2.clone())
        .or_else(|| admin1.clone())
        .or_else(|| text(regeocode.get("formatted_address")))?;
    let address = text(regeocode.get("formatted_address"))
        .map(sanitize_address)
        .unwrap_or_default();
    let admin = AdminFields {
        admin1,
        admin2,
        admin3,
        admin4,
        county,
    };
    Some(make_location(
        name,
        join_address(&[
            admin.admin1.as_deref(),
            admin.admin2.as_deref(),
            admin.admin3.as_deref(),
            admin.admin4.as_deref(),
            Some(&address),
        ]),
        latitude,
        longitude,
        LocationMetadata {
            admin,
            street: None,
            provider: "amap".into(),
            provider_id: None,
            location_type: "地点".into(),
            precision: "locality".into(),
        },
    ))
}

fn map_baidu_reverse(value: &Value, latitude: f64, longitude: f64) -> Option<ResolvedLocation> {
    let result = value.get("result")?;
    let component = result.get("addressComponent")?;
    let admin1 = text(component.get("province"));
    let admin2 = text(component.get("city"));
    let admin3 = text(component.get("district"));
    let admin4 = text(component.get("town"));
    let county = admin3.clone().filter(|value| value.ends_with('县'));
    let name = admin4
        .clone()
        .or_else(|| admin3.clone())
        .or_else(|| admin2.clone())
        .or_else(|| text(result.get("formatted_address")))?;
    let address = text(result.get("formatted_address"))
        .map(sanitize_address)
        .unwrap_or_default();
    let admin = AdminFields {
        admin1,
        admin2,
        admin3,
        admin4,
        county,
    };
    Some(make_location(
        name,
        join_address(&[
            admin.admin1.as_deref(),
            admin.admin2.as_deref(),
            admin.admin3.as_deref(),
            admin.admin4.as_deref(),
            Some(&address),
        ]),
        latitude,
        longitude,
        LocationMetadata {
            admin,
            street: None,
            provider: "baidu".into(),
            provider_id: None,
            location_type: "地点".into(),
            precision: "locality".into(),
        },
    ))
}

fn make_location(
    display_name: String,
    display_address: String,
    latitude: f64,
    longitude: f64,
    metadata: LocationMetadata,
) -> ResolvedLocation {
    ResolvedLocation {
        display_name,
        display_address,
        latitude,
        longitude,
        coordinate_system: "gcj02",
        timezone: None,
        country: Some("中国".into()),
        admin1: metadata.admin.admin1,
        admin2: metadata.admin.admin2,
        admin3: metadata.admin.admin3,
        admin4: metadata.admin.admin4,
        county: metadata.admin.county,
        street: metadata.street,
        provider: metadata.provider,
        provider_id: metadata.provider_id,
        location_type: metadata.location_type,
        precision: metadata.precision,
        source: "manual".into(),
    }
}

fn classify_provider_type(value: Option<&str>) -> String {
    let value = value.unwrap_or_default();
    if value.contains("乡镇") || value.contains("街道") || value == "street" {
        "街镇".into()
    } else if value.contains("村委会") || value.contains("村民委员会") {
        "村委会".into()
    } else if value.contains("学校") || value.contains("大学") || value.contains("教育") {
        "学校".into()
    } else if value.contains("村") || value.contains("乡村") {
        "村庄".into()
    } else if value.contains("社区") {
        "社区".into()
    } else if value.contains("医院") {
        "医院".into()
    } else if value.contains("公园") || value.contains("景点") {
        "公共场所".into()
    } else if value == "district" || value == "行政区" {
        "行政区".into()
    } else {
        "地点".into()
    }
}

fn precision_for_type(location_type: &str) -> &'static str {
    match location_type {
        "街镇" => "locality",
        "行政区" => "district",
        "城市" => "city",
        "省级行政区" => "state",
        "地址" | "道路" => "street",
        _ => "other",
    }
}

fn admin_fields(value: Option<&str>) -> AdminFields {
    let Some(value) = value else {
        return AdminFields::default();
    };
    let units = split_admin_units(value);
    hierarchy_fields(&units)
}

fn split_admin_units(value: &str) -> Vec<String> {
    let suffixes = [
        "特别行政区",
        "维吾尔自治区",
        "壮族自治区",
        "回族自治区",
        "自治区",
        "省",
        "市",
        "自治州",
        "盟",
        "地区",
        "县",
        "区",
        "旗",
        "镇",
        "乡",
        "街道",
    ];
    let mut units = Vec::new();
    let mut start = 0;
    let mut cursor = 0;
    while cursor < value.len() {
        let Some(character) = value[cursor..].chars().next() else {
            break;
        };
        cursor += character.len_utf8();
        let matched = suffixes.iter().find_map(|suffix| {
            value[start..]
                .find(suffix)
                .map(|offset| start + offset + suffix.len())
        });
        if let Some(end) = matched.filter(|end| *end <= cursor) {
            let unit = value[start..end].trim();
            if !unit.is_empty() {
                units.push(unit.to_owned());
            }
            start = end;
            cursor = end;
        }
    }
    let tail = value[start..].trim();
    if !tail.is_empty() {
        units.push(tail.to_owned());
    }
    units
}

fn hierarchy_fields(units: &[String]) -> AdminFields {
    let filtered = units
        .iter()
        .filter(|unit| !unit.is_empty() && unit.as_str() != "中国")
        .collect::<Vec<_>>();
    let admin1 = filtered.first().map(|value| (*value).clone());
    let admin2 = filtered.get(1).map(|value| (*value).clone());
    let admin3 = filtered.get(2).map(|value| (*value).clone());
    let admin4 = filtered.get(3).map(|value| (*value).clone());
    let county = admin3
        .clone()
        .filter(|value| value.ends_with("县") || value.ends_with("旗"));
    AdminFields {
        admin1,
        admin2,
        admin3,
        admin4,
        county,
    }
}

fn join_address(parts: &[Option<&str>]) -> String {
    let mut seen = Vec::new();
    for part in parts
        .iter()
        .flatten()
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
    {
        if !seen
            .iter()
            .any(|existing: &&str| normalize_text(existing) == normalize_text(part))
        {
            seen.push(part);
        }
    }
    seen.join(" · ")
}

fn sanitize_address(value: String) -> String {
    let Some((index, _)) = value.char_indices().find(|(index, character)| {
        if !character.is_ascii_digit() {
            return false;
        }
        let tail = &value[*index..];
        let digits = tail
            .chars()
            .take_while(|item| item.is_ascii_digit())
            .count();
        let after_digits = &tail[digits..];
        ["号", "弄", "室", "单元", "栋", "幢"]
            .iter()
            .any(|marker| after_digits.starts_with(marker))
    }) else {
        return value;
    };
    value[..index].trim().to_owned()
}

fn rank_and_deduplicate(
    mut locations: Vec<ResolvedLocation>,
    query: &str,
    hint: Option<&str>,
) -> Vec<ResolvedLocation> {
    locations.retain(|location| {
        valid_coordinates(location.latitude, location.longitude)
            && !location.display_name.trim().is_empty()
    });
    locations.sort_by_key(|location| std::cmp::Reverse(location_score(location, query, hint)));
    let mut deduplicated: Vec<ResolvedLocation> = Vec::new();
    for location in locations {
        if let Some(existing) = deduplicated
            .iter_mut()
            .find(|existing| same_location(existing, &location))
        {
            if existing.display_address.len() < location.display_address.len() {
                existing.display_address = location.display_address;
            }
            if existing.provider != "amap" && location.provider == "amap" {
                existing.provider = location.provider;
            }
            continue;
        }
        deduplicated.push(location);
        if deduplicated.len() >= MAX_RESULTS {
            break;
        }
    }
    deduplicated
}

fn location_score(location: &ResolvedLocation, query: &str, hint: Option<&str>) -> i32 {
    let query = normalize_text(query);
    let name = normalize_text(&location.display_name);
    let address = normalize_text(&location.display_address);
    let mut score = if name == query {
        1_000
    } else if name.contains(&query) {
        500
    } else if address.contains(&query) {
        200
    } else {
        0
    };
    if let Some(hint) = hint.map(normalize_text).filter(|value| !value.is_empty()) {
        if address.contains(&hint) {
            score += 100;
        }
    }
    score += match location.location_type.as_str() {
        "村委会" | "村庄" | "学校" | "街镇" => 40,
        "地点" => 5,
        _ => 20,
    };
    if location.provider == "amap" {
        score += 2;
    }
    score
}

fn same_location(left: &ResolvedLocation, right: &ResolvedLocation) -> bool {
    let names_match =
        normalized_place_name(&left.display_name) == normalized_place_name(&right.display_name);
    let meters = distance_meters(
        left.latitude,
        left.longitude,
        right.latitude,
        right.longitude,
    );
    if names_match && meters <= 250.0 {
        return true;
    }
    let hierarchy_overlap = [
        (&left.admin1, &right.admin1),
        (&left.admin2, &right.admin2),
        (&left.admin3, &right.admin3),
        (&left.admin4, &right.admin4),
    ]
    .iter()
    .any(|(a, b)| {
        a.as_ref()
            .zip(b.as_ref())
            .is_some_and(|(a, b)| normalize_text(a) == normalize_text(b))
    });
    meters <= 40.0 && hierarchy_overlap
}

fn normalized_place_name(name: &str) -> String {
    let mut name = normalize_text(name);
    for suffix in ["村民委员会", "村委会", "村民小组", "居民委员会", "居委会"] {
        name = name.replace(suffix, "");
    }
    name
}

fn distance_meters(lat_a: f64, lon_a: f64, lat_b: f64, lon_b: f64) -> f64 {
    let radius = 6_371_000.0;
    let d_lat = (lat_b - lat_a).to_radians();
    let d_lon = (lon_b - lon_a).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat_a.to_radians().cos() * lat_b.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * radius * a.sqrt().atan2((1.0 - a).sqrt())
}

fn text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
}

fn coordinate_pair(value: &str) -> Option<(f64, f64)> {
    let (longitude, latitude) = value.split_once(',')?;
    let longitude = longitude.trim().parse().ok()?;
    let latitude = latitude.trim().parse().ok()?;
    valid_coordinates(latitude, longitude).then_some((longitude, latitude))
}

fn valid_coordinates(latitude: f64, longitude: f64) -> bool {
    latitude.is_finite()
        && (-90.0..=90.0).contains(&latitude)
        && longitude.is_finite()
        && (-180.0..=180.0).contains(&longitude)
}

#[cfg(debug_assertions)]
fn trace_provider(
    provider: &str,
    operation: &str,
    status: &str,
    elapsed: Duration,
    result: &str,
    count: Option<usize>,
) {
    eprintln!(
        "[weather-location] provider={provider} operation={operation} status={status} elapsed_ms={} result={result} result_count={}",
        elapsed.as_millis(),
        count.map_or_else(|| "n/a".to_owned(), |value| value.to_string())
    );
}

#[cfg(not(debug_assertions))]
fn trace_provider(
    _provider: &str,
    _operation: &str,
    _status: &str,
    _elapsed: Duration,
    _result: &str,
    _count: Option<usize>,
) {
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        thread,
    };

    fn sample_location(
        name: &str,
        provider: &str,
        longitude: f64,
        latitude: f64,
    ) -> ResolvedLocation {
        make_location(
            name.into(),
            "江苏省 · 南通市 · 崇川区".into(),
            latitude,
            longitude,
            LocationMetadata {
                admin: AdminFields {
                    admin1: Some("江苏省".into()),
                    admin2: Some("南通市".into()),
                    admin3: Some("崇川区".into()),
                    ..AdminFields::default()
                },
                street: None,
                provider: provider.into(),
                provider_id: None,
                location_type: "地点".into(),
                precision: "other".into(),
            },
        )
    }

    #[test]
    fn classifies_long_address_poi_rural_and_short_admin_queries() {
        assert_eq!(
            classify_query("江苏省南通市崇川区青年中路88号"),
            QueryIntent::FullAddress
        );
        assert_eq!(classify_query("南通大学"), QueryIntent::Poi);
        assert_eq!(classify_query("邢楼镇"), QueryIntent::Administrative);
        assert_eq!(classify_query("王村"), QueryIntent::General);
        assert!(validate_query("李庄").is_ok());
        assert!(validate_query("李").is_err());
    }

    #[test]
    fn strategy_classifier_uses_all_four_amap_search_families_without_unbounded_fanout() {
        assert_eq!(
            amap_strategies(QueryIntent::Administrative)[0],
            AmapStrategy::District
        );
        assert_eq!(amap_strategies(QueryIntent::Poi)[1], AmapStrategy::Poi);
        assert_eq!(
            amap_strategies(QueryIntent::FullAddress)[0],
            AmapStrategy::Geocode
        );
        assert!(amap_strategies(QueryIntent::General).len() <= 3);
    }

    #[test]
    fn admin_hierarchy_parser_preserves_province_city_county_and_township() {
        let admin = admin_fields(Some("江苏省徐州市丰县邢楼镇"));
        assert_eq!(admin.admin1.as_deref(), Some("江苏省"));
        assert_eq!(admin.admin2.as_deref(), Some("徐州市"));
        assert_eq!(admin.admin3.as_deref(), Some("丰县"));
        assert_eq!(admin.admin4.as_deref(), Some("邢楼镇"));
        assert_eq!(admin.county.as_deref(), Some("丰县"));
    }

    #[test]
    fn amap_tip_mapper_normalizes_only_gcj02_and_redacts_house_number_from_display_address() {
        let tip = json!({
            "id":"amap-id",
            "name":"学校附近",
            "district":"江苏省徐州市丰县邢楼镇",
            "address":"人民路88号",
            "location":"116.123456,34.123456",
            "type":"教育学校;小学"
        });
        let mapped = amap_tip(&tip, "学校附近").unwrap();
        assert_eq!(mapped.coordinate_system, "gcj02");
        assert_eq!(mapped.admin4.as_deref(), Some("邢楼镇"));
        assert_eq!(mapped.location_type, "学校");
        assert!(!mapped.display_address.contains("88号"));
    }

    #[test]
    fn ranking_prefers_exact_match_and_deduplicates_provider_synonyms() {
        let results = rank_and_deduplicate(
            vec![
                sample_location("李家村村委会", "baidu", 120.0, 32.0),
                sample_location("李家村村民委员会", "amap", 120.0002, 32.0001),
                sample_location("其他李家村", "amap", 121.0, 33.0),
            ],
            "李家村村委会",
            None,
        );
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].display_name, "李家村村委会");
    }

    #[test]
    fn baidu_conversion_requests_the_documented_model_and_returns_gcj02() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]).into_owned();
            let body = r#"{"status":0,"result":[{"x":120.004,"y":32.003}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            request
        });
        let state = GeocodingState::with_config(
            "http://127.0.0.1:1/",
            &format!("http://{address}/"),
            Duration::from_secs(1),
        )
        .unwrap();
        let candidate = BaiduCandidate {
            raw: json!({
                "name":"王村",
                "province":"江苏省",
                "city":"徐州市",
                "area":"丰县",
                "town":"邢楼镇"
            }),
            longitude: 120.0,
            latitude: 32.0,
            is_geocode: false,
        };
        let locations = tauri::async_runtime::block_on(state.convert_baidu_candidates(
            vec![candidate],
            "baidu-test-key",
            "王村",
        ))
        .unwrap();
        let request = worker.join().unwrap();
        assert!(request.contains("model=5"));
        assert!(request.contains("coords=120.000000%2C32.000000"));
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].coordinate_system, "gcj02");
        assert_eq!(locations[0].longitude, 120.004);
        assert_eq!(locations[0].latitude, 32.003);
        assert_eq!(locations[0].admin4.as_deref(), Some("邢楼镇"));
    }

    #[test]
    fn empty_amap_search_falls_back_to_baidu_place_and_converts_coordinates() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let mut requests = Vec::new();
            let responses = [
                r#"{"status":"1","tips":[]}"#,
                r#"{"status":"1","pois":[]}"#,
                r#"{"status":0,"results":[{"name":"李家村","province":"江苏省","city":"徐州市","area":"丰县","town":"邢楼镇","location":{"lng":120.0,"lat":32.0},"uid":"bd-rural-1","detail_info":{"tag":"村庄"}}]}"#,
                r#"{"status":0,"result":[{"x":120.004,"y":32.003}]}"#,
            ];
            for body in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 4096];
                let count = stream.read(&mut request).unwrap();
                requests.push(String::from_utf8_lossy(&request[..count]).into_owned());
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        });
        let base_url = format!("http://{address}/");
        let state =
            GeocodingState::with_config(&base_url, &base_url, Duration::from_secs(1)).unwrap();
        let cancelled = AtomicBool::new(false);
        let locations = tauri::async_runtime::block_on(state.search_with_keys(
            "李家村",
            None,
            Some("amap-test-key"),
            Some("baidu-test-key"),
            &cancelled,
        ))
        .unwrap();
        let requests = worker.join().unwrap();

        assert_eq!(requests.len(), 4);
        assert!(requests[0].contains("/v3/assistant/inputtips"));
        assert!(requests[1].contains("/v3/place/text"));
        assert!(requests[2].contains("/place/v3/search"));
        assert!(requests[3].contains("/geoconv/v2/"));
        assert!(requests[3].contains("model=5"));
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].display_name, "李家村");
        assert_eq!(locations[0].provider, "baidu");
        assert_eq!(locations[0].coordinate_system, "gcj02");
        assert_eq!(locations[0].longitude, 120.004);
        assert_eq!(locations[0].latitude, 32.003);
        assert_eq!(locations[0].admin4.as_deref(), Some("邢楼镇"));
    }

    #[test]
    fn amap_transport_failure_still_allows_baidu_fallback() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let responses = [
                r#"{"status":0,"results":[{"name":"李家村","province":"江苏省","city":"徐州市","area":"丰县","town":"邢楼镇","location":{"lng":120.0,"lat":32.0},"uid":"bd-rural-1"}]}"#,
                r#"{"status":0,"result":[{"x":120.004,"y":32.003}]}"#,
            ];
            for body in responses {
                let (stream, _) = listener.accept().unwrap();
                let mut stream = BufReader::new(stream);
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    if stream.read_line(&mut line).unwrap() == 0 {
                        break;
                    }
                    let done = line == "\r\n";
                    request.push_str(&line);
                    if done {
                        break;
                    }
                }
                assert!(request.starts_with("GET "));
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.get_mut().write_all(response.as_bytes()).unwrap();
            }
        });
        let baidu_url = format!("http://{address}/");
        let state =
            GeocodingState::with_config("http://127.0.0.1:1/", &baidu_url, Duration::from_secs(1))
                .unwrap();
        let cancelled = AtomicBool::new(false);
        let locations = tauri::async_runtime::block_on(state.search_with_keys(
            "李家村",
            None,
            Some("amap-test-key"),
            Some("baidu-test-key"),
            &cancelled,
        ))
        .unwrap();
        worker.join().unwrap();

        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].provider, "baidu");
        assert_eq!(locations[0].coordinate_system, "gcj02");
    }

    #[test]
    fn cancelled_search_stops_before_issuing_the_next_provider_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let server_cancelled = Arc::clone(&cancelled);
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]).into_owned();
            server_cancelled.store(true, Ordering::Relaxed);
            let body = r#"{"status":"1","tips":[]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            request
        });
        let state = GeocodingState::with_config(
            &format!("http://{address}/"),
            "http://127.0.0.1:1/",
            Duration::from_secs(1),
        )
        .unwrap();
        let result = tauri::async_runtime::block_on(state.search_with_keys(
            "李家村",
            None,
            Some("amap-test-key"),
            None,
            &cancelled,
        ));
        let request = worker.join().unwrap();
        assert!(request.contains("inputtips"));
        assert_eq!(result, Err(ProviderError::Cancelled));
    }

    #[test]
    fn static_map_response_is_limited_and_returns_verified_image_type() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]).into_owned();
            let image = b"\x89PNG\r\n\x1a\nfixture";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                image.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            stream.write_all(image).unwrap();
            request
        });
        let state = GeocodingState::with_config(
            &format!("http://{address}/"),
            "http://127.0.0.1:1/",
            Duration::from_secs(1),
        )
        .unwrap();
        let image =
            tauri::async_runtime::block_on(state.map_image(31.2, 121.4, 10, "map-test-key"))
                .unwrap();
        let request = worker.join().unwrap();
        assert_eq!(image.mime_type, "image/png");
        assert!(request.contains("v3/staticmap"));
        assert!(request.contains("key=map-test-key"));
    }

    #[test]
    fn mocked_amap_request_is_keyed_in_backend_and_returns_gcj02_result() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]).into_owned();
            let body = r#"{"status":"1","tips":[{"name":"王村","district":"江苏省徐州市丰县","location":"116.1,34.2","type":"村庄"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            request
        });
        let state = GeocodingState::with_config(
            &format!("http://{address}/"),
            "http://127.0.0.1:1/",
            Duration::from_secs(1),
        )
        .unwrap();
        let response = tauri::async_runtime::block_on(state.amap_strategy(
            AmapStrategy::Tips,
            "王村",
            "secret-test-key",
        ))
        .unwrap();
        let request = worker.join().unwrap();
        assert!(request.contains("key=secret-test-key"));
        assert_eq!(response[0].display_name, "王村");
        assert_eq!(response[0].coordinate_system, "gcj02");
    }

    #[test]
    #[ignore = "requires configured Windows AMap credentials and live network access"]
    fn live_amap_weather_search_and_static_map_smoke() {
        let amap_key = credential(AMAP_ACCOUNT)
            .expect("Windows credential storage should be available")
            .filter(|key| !key.trim().is_empty())
            .expect("configure an AMap Web Service key in Weather settings first");
        let state = GeocodingState::new().expect("create live provider client");
        let cancellation = AtomicBool::new(false);
        let mut search_pass = true;
        let mut xuzhou_center = (34.2044, 117.2841);

        for (label, query) in [("city", "徐州市"), ("county", "丰县"), ("town", "邢楼镇")] {
            match tauri::async_runtime::block_on(state.search_with_keys(
                query,
                None,
                Some(&amap_key),
                None,
                &cancellation,
            )) {
                Ok(locations) => {
                    let amap_count = locations
                        .iter()
                        .filter(|location| location.provider == "amap")
                        .count();
                    eprintln!("live AMap {label} search: {amap_count} candidates");
                    if query == "徐州市" {
                        if let Some(location) = locations.first() {
                            xuzhou_center = (location.latitude, location.longitude);
                        }
                    }
                    search_pass &= !locations.is_empty();
                }
                Err(error) => {
                    eprintln!("live AMap {label} search failed: {error:?}");
                    search_pass = false;
                }
            }
        }

        let map_result = tauri::async_runtime::block_on(state.map_image(
            xuzhou_center.0,
            xuzhou_center.1,
            7,
            &amap_key,
        ));
        match &map_result {
            Ok(image) => eprintln!(
                "live AMap static map: {} bytes ({})",
                image.bytes.len(),
                image.mime_type
            ),
            Err(error) => eprintln!("live AMap static map failed: {error:?}"),
        }

        assert!(
            search_pass,
            "one or more live city/county/town searches failed"
        );
        assert!(map_result.is_ok(), "live AMap static map request failed");
    }
}

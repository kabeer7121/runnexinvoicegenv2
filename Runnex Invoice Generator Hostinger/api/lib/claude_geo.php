<?php
declare(strict_types=1);

/** Normalizes pasted keys (line breaks, NBSP, BOM, accidental wrapping quotes). */
function sanitize_anthropic_api_key(string $raw): string
{
    $k = trim($raw);
    $k = preg_replace('/^\xEF\xBB\xBF/', '', $k) ?? $k;
    $k = preg_replace('/[\x{200B}-\x{200F}\x{FEFF}\x{00A0}]/u', '', $k) ?? $k;
    $k = preg_replace('/\s+/u', '', $k) ?? $k;
    if (strlen($k) >= 2) {
        $q = $k[0];
        if (($q === '"' || $q === "'") && $k[strlen($k) - 1] === $q) {
            $k = substr($k, 1, -1);
        }
    }

    return trim($k);
}

/** @return array<string,mixed>|null */
function anthropic_extract_logistics_pdf(string $pdfBinary, array $secrets): ?array
{
    $key = sanitize_anthropic_api_key((string) ($secrets['anthropic_api_key'] ?? ''));
    if ($key === '' || ($secrets['anthropic_disabled'] ?? '') === '1') {
        return null;
    }
    $model = trim((string) ($secrets['anthropic_model'] ?? '')) ?: 'claude-sonnet-4-20250514';
    $system = "You are a logistics data extractor. Read the PDF and return ONLY a JSON object with keys: pickup_address, dropoff_address, pickup_city, pickup_state, dropoff_city, dropoff_state, pickup_date, dropoff_date, total_rate, total_miles, load_id, broker_name, commodity, weight.\n\n" .
        "Rules:\n" .
        "- pickup_address / dropoff_address: full street-style addresses when present (address-to-address), including city/state/ZIP parts if available. Remove labels like PICKUP:, DELIVER TO:, etc.\n" .
        "- pickup_city / dropoff_city: city name ONLY—never include words like PICK UP, DROP OFF, ORIGIN, DESTINATION, or colons/labels before the city.\n" .
        "- pickup_state / dropoff_state: two-letter US state abbreviation when possible.\n" .
        "- pickup_date / dropoff_date: appointment or scheduled pickup and delivery dates from the document. Output each as YYYY-MM-DD if you can infer a calendar date; otherwise \"\". Do not add labels or words—digits and hyphens only when set.\n" .
        "- total_rate: the load rate only—digits, optional \$, comma, decimal. Do not include words like RATE, LINE HAUL, or PAY.\n" .
        "- total_miles: loaded miles as a numeric string. If the PDF does not show miles, estimate typical loaded truck miles between pickup_address and dropoff_address (address-to-address highway approximation).\n" .
        "- load_id: primary load identifier from the document (PRO, BOL, load number, confirmation, order #)—short alphanumeric, UPPERCASE; \"\" if not found.\n" .
        "- broker_name: the broker or logistics company on the rate confirmation (not the carrier driver company); UPPERCASE; \"\" if not found.\n" .
        "- commodity: specific product or freight description if stated; \"\" if not stated, generic freight, or FAK-style wording (downstream will use FAK).\n" .
        "- weight: shipment weight as digits only (no LBS, KG, or words)—e.g. \"42500\"; \"\" if not shown.\n" .
        "- Use UPPERCASE for city, state, rate, load_id, broker_name, commodity string values; miles and weight as reasonable numeric strings; dates as YYYY-MM-DD or \"\".\n" .
        'No markdown, no text outside the JSON.';
    $userText = 'Output only the JSON. All fourteen keys required; use "" only when a value is truly unknown (still estimate miles when addresses are known).';

    $body = [
        'model' => $model,
        'max_tokens' => 2048,
        'temperature' => 0.1,
        'system' => $system,
        'messages' => [
            [
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'document',
                        'source' => [
                            'type' => 'base64',
                            'media_type' => 'application/pdf',
                            'data' => base64_encode($pdfBinary),
                        ],
                    ],
                    ['type' => 'text', 'text' => $userText],
                ],
            ],
        ],
    ];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-api-key: ' . $key,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_TIMEOUT => 120,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $code < 200 || $code >= 300) {
        if ($code === 401) {
            return ['_error' => 'Anthropic rejected the API key (HTTP 401). In api/secrets.php set anthropic_api_key to the full secret from console.anthropic.com (format sk-ant-api03-…). Re-copy with no spaces or line breaks, or create a new key. Do not use an OpenAI or other vendor key.'];
        }

        return ['_error' => 'Anthropic HTTP ' . $code . ': ' . substr((string) $raw, 0, 500)];
    }
    $resp = json_decode($raw, true);
    if (!is_array($resp)) {
        return ['_error' => 'Invalid Anthropic response'];
    }
    $text = '';
    foreach ($resp['content'] ?? [] as $block) {
        if (($block['type'] ?? '') === 'text' && !empty($block['text'])) {
            $text .= $block['text'];
        }
    }
    $text = trim($text);
    if ($text === '') {
        return ['_error' => 'Empty model output'];
    }
    if (preg_match('/```(?:json)?\s*([\s\S]*?)```/i', $text, $m)) {
        $text = trim($m[1]);
    }
    $start = strpos($text, '{');
    $end = strrpos($text, '}');
    if ($start !== false && $end > $start) {
        $text = substr($text, $start, $end - $start + 1);
    }
    $parsed = json_decode($text, true);
    if (!is_array($parsed)) {
        return ['_error' => 'Could not parse JSON from model'];
    }

    return $parsed;
}

function strip_label_noise(string $s): string
{
    $s = preg_replace('/^(pick\s*up|pickup|pu|origin|shipper|load\s*at|from)\s*[:\-–]\s*/i', '', $s) ?? $s;
    $s = preg_replace('/^(drop\s*off|dropoff|delivery|destination|dest|del|consignee|to)\s*[:\-–]\s*/i', '', $s) ?? $s;
    $s = preg_replace('/^(pickup\s*address|dropoff\s*address|address)\s*[:\-–]\s*/i', '', $s) ?? $s;
    $s = preg_replace('/^(rate|line\s*haul|total\s*rate|pay|amount)\s*[:\-–]?\s*\$?\s*/i', '', $s) ?? $s;

    return trim($s);
}

/** @param array<string,mixed> $raw */
function map_claude_to_app_fields(array $raw): array
{
    $pickupAddress = trim(strip_label_noise((string) ($raw['pickup_address'] ?? '')));
    $pickupAddress = strtoupper(preg_replace('/\s+/', ' ', $pickupAddress) ?? $pickupAddress);
    $dropoffAddress = trim(strip_label_noise((string) ($raw['dropoff_address'] ?? '')));
    $dropoffAddress = strtoupper(preg_replace('/\s+/', ' ', $dropoffAddress) ?? $dropoffAddress);

    $pc = strtoupper(trim(strip_label_noise((string) ($raw['pickup_city'] ?? ''))));
    $pc = strtoupper(preg_replace('/\s+/', ' ', $pc) ?? $pc);
    $ps = strtoupper(str_replace('.', '', trim(strip_label_noise((string) ($raw['pickup_state'] ?? '')))));
    $dc = strtoupper(trim(strip_label_noise((string) ($raw['dropoff_city'] ?? ''))));
    $dc = strtoupper(preg_replace('/\s+/', ' ', $dc) ?? $dc);
    $ds = strtoupper(str_replace('.', '', trim(strip_label_noise((string) ($raw['dropoff_state'] ?? '')))));
    $tr = strtoupper(trim(strip_label_noise(preg_replace('/^\$\s*/', '', (string) ($raw['total_rate'] ?? '')))));
    $tmRaw = strip_label_noise((string) ($raw['total_miles'] ?? ''));
    $tmRaw = str_replace(',', '', $tmRaw);
    preg_match('/\d+\.?\d*/', $tmRaw, $mm);
    $tm = '';
    if (!empty($mm[0])) {
        $n = (int) round((float) $mm[0]);
        if ($n > 0) {
            $tm = (string) $n;
        }
    }
    $pud = normalize_iso_date_php((string) ($raw['pickup_date'] ?? ''));
    $dod = normalize_iso_date_php((string) ($raw['dropoff_date'] ?? ''));

    // Keep invoice fields as city/state only; full addresses are used only for better miles extraction.
    $origin = ($pc && $ps) ? "{$pc}, {$ps}" : ($pc ?: $ps);
    $destination = ($dc && $ds) ? "{$dc}, {$ds}" : ($dc ?: $ds);

    $loadId = strtoupper(trim(strip_label_noise((string) ($raw['load_id'] ?? ''))));
    $loadId = preg_replace('/\s+/', ' ', $loadId) ?? $loadId;
    $broker = strtoupper(trim(strip_label_noise((string) ($raw['broker_name'] ?? $raw['broker'] ?? ''))));
    $broker = preg_replace('/\s+/', ' ', $broker) ?? $broker;
    $commodity = trim(strip_label_noise((string) ($raw['commodity'] ?? '')));
    $commodity = $commodity !== '' ? strtoupper(preg_replace('/\s+/', ' ', $commodity) ?? $commodity) : '';
    $weight = normalize_weight_digits_only(strip_label_noise((string) ($raw['weight'] ?? '')));

    return [
        'origin' => $origin,
        'destination' => $destination,
        'miles' => $tm,
        'reference' => '',
        'rate' => $tr,
        'pickup_date' => $pud,
        'dropoff_date' => $dod,
        'pickup_city' => $pc,
        'pickup_state' => $ps,
        'dropoff_city' => $dc,
        'dropoff_state' => $ds,
        'pickup_address' => $pickupAddress,
        'dropoff_address' => $dropoffAddress,
        'total_rate' => $tr,
        'total_miles' => $tm,
        'load_id' => $loadId,
        'broker_name' => $broker,
        'commodity' => $commodity,
        'weight' => $weight,
    ];
}

function normalize_iso_date_php(string $s): string
{
    $t = strip_label_noise($s);
    $t = preg_replace('/\s+/', '', $t) ?? $t;
    if ($t === '') {
        return '';
    }
    if (preg_match('/(\d{4}-\d{2}-\d{2})/', $t, $iso)) {
        return $iso[1];
    }
    if (preg_match('/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/', $t, $us)) {
        $mm = (int) $us[1];
        $dd = (int) $us[2];
        $yy = (int) $us[3];
        if ($yy < 100) {
            $yy += 2000;
        }
        if ($mm >= 1 && $mm <= 12 && $dd >= 1 && $dd <= 31 && $yy >= 2000 && $yy <= 2100) {
            return sprintf('%04d-%02d-%02d', $yy, $mm, $dd);
        }
    }

    return '';
}

const INVOICEPILOT_UA = 'InvoicePilot/1.0 (shared-hosting PHP; logistics invoice helper)';
const ROAD_FACTOR_MILES = 1.22;
const M_PER_MILE = 1609.344;

function haversine_miles(float $lat1, float $lon1, float $lat2, float $lon2): float
{
    $R = 3958.7613;
    $toR = static fn ($d) => ($d * M_PI) / 180;
    $dLat = $toR($lat2 - $lat1);
    $dLon = $toR($lon2 - $lon1);
    $a = sin($dLat / 2) ** 2 + cos($toR($lat1)) * cos($toR($lat2)) * sin($dLon / 2) ** 2;

    return $R * (2 * atan2(sqrt($a), sqrt(1 - $a)));
}

/** @return array{lat:float,lon:float}|null */
function nominatim_geocode_query(string $query): ?array
{
    $qRaw = trim($query);
    if ($qRaw === '') {
        return null;
    }
    $q = rawurlencode($qRaw);
    $url = "https://nominatim.openstreetmap.org/search?q={$q}&format=json&limit=1";
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['User-Agent: ' . INVOICEPILOT_UA],
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($ch);
    curl_close($ch);
    if ($raw === false) {
        return null;
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data[0]['lat'])) {
        return null;
    }
    $lat = (float) $data[0]['lat'];
    $lon = (float) $data[0]['lon'];
    if (!is_finite($lat) || !is_finite($lon)) {
        return null;
    }

    return ['lat' => $lat, 'lon' => $lon];
}

/** @return array{lat:float,lon:float}|null */
function nominatim_geocode(string $city, string $state): ?array
{
    $c = trim($city);
    $s = trim($state);
    if ($c === '' || $s === '') {
        return null;
    }
    return nominatim_geocode_query("{$c}, {$s}, United States");
}

function osrm_route_miles(float $aLat, float $aLon, float $bLat, float $bLon): ?float
{
    $url = sprintf(
        'https://router.project-osrm.org/route/v1/driving/%.6f,%.6f;%.6f,%.6f?overview=false',
        $aLon,
        $aLat,
        $bLon,
        $bLat
    );
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['User-Agent: ' . INVOICEPILOT_UA],
        CURLOPT_TIMEOUT => 25,
    ]);
    $raw = curl_exec($ch);
    curl_close($ch);
    if ($raw === false) {
        return null;
    }
    $json = json_decode($raw, true);
    if (!is_array($json) || ($json['code'] ?? '') !== 'Ok' || empty($json['routes'][0]['distance'])) {
        return null;
    }
    $meters = (float) $json['routes'][0]['distance'];
    if (!is_finite($meters) || $meters <= 0) {
        return null;
    }
    $miles = $meters / M_PER_MILE;
    return is_finite($miles) && $miles > 0 ? $miles : null;
}

function google_maps_route_miles(string $origin, string $destination): ?float
{
    $key = trim((string) ($GLOBALS['secrets']['google_maps_api_key'] ?? ''));
    if ($key === '') {
        return null;
    }
    $o = trim($origin);
    $d = trim($destination);
    if ($o === '' || $d === '') {
        return null;
    }
    $url = 'https://maps.googleapis.com/maps/api/distancematrix/json?origins=' .
        rawurlencode($o) .
        '&destinations=' .
        rawurlencode($d) .
        '&mode=driving&units=imperial&key=' .
        rawurlencode($key);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['User-Agent: ' . INVOICEPILOT_UA],
        CURLOPT_TIMEOUT => 25,
    ]);
    $raw = curl_exec($ch);
    curl_close($ch);
    if ($raw === false) {
        return null;
    }
    $json = json_decode($raw, true);
    if (!is_array($json) || ($json['status'] ?? '') !== 'OK') {
        return null;
    }
    $el = $json['rows'][0]['elements'][0] ?? null;
    if (!is_array($el) || ($el['status'] ?? '') !== 'OK') {
        return null;
    }
    $meters = (float) ($el['distance']['value'] ?? 0);
    if (!is_finite($meters) || $meters <= 0) {
        return null;
    }
    $miles = $meters / M_PER_MILE;
    return is_finite($miles) && $miles > 0 ? $miles : null;
}

function estimate_loaded_miles_php(
    string $pickupCity,
    string $pickupState,
    string $dropCity,
    string $dropState,
    string $pickupAddress = '',
    string $dropoffAddress = ''
): string
{
    try {
        $pAddr = trim($pickupAddress);
        $dAddr = trim($dropoffAddress);
        $pCityState = trim($pickupCity . ', ' . $pickupState . ', United States');
        $dCityState = trim($dropCity . ', ' . $dropState . ', United States');

        // 1) Google Maps driving route (most accurate, if API key configured).
        $gOrigin = $pAddr !== '' ? ($pAddr . ', United States') : $pCityState;
        $gDest = $dAddr !== '' ? ($dAddr . ', United States') : $dCityState;
        $googleMiles = google_maps_route_miles($gOrigin, $gDest);
        if ($googleMiles !== null) {
            $miles = (int) round($googleMiles);
            return $miles > 0 ? (string) $miles : '';
        }

        // 2) Open route fallback (OSRM) via geocoded coordinates.
        $a = null;
        $b = null;

        if ($pAddr !== '' && $dAddr !== '') {
            $a = nominatim_geocode_query($pAddr . ', United States');
            usleep(1100000);
            $b = nominatim_geocode_query($dAddr . ', United States');
        }
        if (!$a || !$b) {
            $a = nominatim_geocode($pickupCity, $pickupState);
            usleep(1100000);
            $b = nominatim_geocode($dropCity, $dropState);
        }
        if (!$a || !$b) {
            return '';
        }

        // Routed driving distance fallback.
        $routed = osrm_route_miles($a['lat'], $a['lon'], $b['lat'], $b['lon']);
        if ($routed !== null) {
            $miles = (int) round($routed);
            return $miles > 0 ? (string) $miles : '';
        }

        // 3) Last fallback if routing APIs are unavailable.
        $straight = haversine_miles($a['lat'], $a['lon'], $b['lat'], $b['lon']);
        $miles = (int) round($straight * ROAD_FACTOR_MILES);
        if ($miles < 1) {
            return '';
        }

        return (string) $miles;
    } catch (Throwable $e) {
        return '';
    }
}

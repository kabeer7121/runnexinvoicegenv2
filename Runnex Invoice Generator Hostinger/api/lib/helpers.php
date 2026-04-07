<?php
declare(strict_types=1);

function json_response(mixed $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** @return array<string,mixed> */
function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function is_admin(): bool
{
    return isset($_SESSION['role']) && strtolower((string) $_SESSION['role']) === 'admin';
}

function require_login(): void
{
    if (empty($_SESSION['user_id'])) {
        json_response(['error' => 'Unauthorized'], 401);
    }
}

function require_admin(): void
{
    require_login();
    if (!is_admin()) {
        json_response(['error' => 'Admin access required'], 403);
    }
}

function parse_client_id(mixed $v): ?int
{
    if ($v === null || $v === '') {
        return null;
    }
    $n = (int) $v;
    return $n > 0 ? $n : null;
}

function parse_payment_account_id(mixed $v): ?int
{
    if ($v === null || $v === '') {
        return null;
    }
    $n = (int) $v;
    return $n > 0 ? $n : null;
}

/** Returns null if id is missing or no matching row (invalid ids are ignored). */
function resolve_payment_account_id(mixed $v): ?int
{
    $id = parse_payment_account_id($v);
    if ($id === null) {
        return null;
    }
    $st = db()->prepare('SELECT id FROM payment_accounts WHERE id = ?');
    $st->execute([$id]);

    return $st->fetch() ? $id : null;
}

function norm_number(mixed $v): float
{
    if ($v === null || $v === '') {
        return 0.0;
    }
    $s = str_replace([',', '$'], '', trim((string) $v));
    $n = (float) $s;
    return is_finite($n) ? $n : 0.0;
}

/** Ship weight: first numeric value only, no units (LBS, KG, etc.). */
function normalize_weight_digits_only(string $s): string
{
    $t = trim($s);
    $t = str_replace([',', ' ', "\xc2\xa0"], '', $t);
    if ($t === '' || !preg_match('/(\d+\.?\d*)/', $t, $m)) {
        return '';
    }
    $n = (float) $m[1];
    if (!is_finite($n) || $n < 0) {
        return '';
    }
    if (abs($n - round($n)) < 1e-6) {
        return (string) (int) round($n);
    }

    return rtrim(rtrim(sprintf('%.4f', $n), '0'), '.');
}

/** Normalize JSON row keys (handles "Dispatcher Fee", camelCase, etc.). */
function metric_normalize_key(mixed $k): string
{
    $s = trim((string) $k);
    $s = preg_replace('/([a-z\d])([A-Z])/', '$1_$2', $s) ?? $s;
    $s = strtolower($s);
    $s = str_replace([' ', '-'], '_', $s);
    $s = preg_replace('/_+/', '_', $s) ?? $s;

    return $s;
}

function metric_key_is_dispatcher_fee(string $nk): bool
{
    if ($nk === '' || str_contains($nk, 'rpm')) {
        return false;
    }
    if (in_array($nk, [
        'dispatcher_fee', 'dispatch_fee', 'dispatcherfees', 'dispatchfees',
        'disp_fee', 'dispfee', 'd_fee', 'dfee',
    ], true)) {
        return true;
    }
    if (preg_match('/^(dispatcher|dispatch)(_fees?|fee)$/', $nk)) {
        return true;
    }
    if (str_contains($nk, 'dispatcher') && str_contains($nk, 'fee')) {
        return true;
    }
    if (str_contains($nk, 'dispatch') && str_contains($nk, 'fee') && !str_contains($nk, 'rate')) {
        return true;
    }

    return false;
}

function metric_key_is_line_haul_rate(string $nk): bool
{
    return in_array($nk, ['rate', 'line_haul', 'linehaul', 'total_rate', 'haul_rate', 'linehaul_rate'], true)
        || preg_match('/^(line_?haul|total_?rate|haul_?rate)$/', $nk);
}

/**
 * Client report row metrics. Dispatcher fee is only from fee columns (never line haul).
 * Invoice amount = line haul + dispatcher fee when both exist, else explicit invoice_* column, else rate or fee alone.
 *
 * @param array<string,mixed>|null $rowData
 * @return array{miles:float,rate:float,dispatcherFee:float,invoiceAmount:float,origin:string,destination:string,pickupDate:string,dropoffDate:string,rpm:float}
 */
function metric_from_row_data(?array $rowData): array
{
    $obj = is_array($rowData) ? $rowData : [];
    $miles = 0.0;
    $rate = 0.0;
    $explicitDisp = 0.0;
    $fallbackAmt = 0.0;
    $invoiceCol = 0.0;
    $origin = '';
    $destination = '';
    $pickupDate = '';
    $dropoffDate = '';

    foreach ($obj as $k => $v) {
        $nk = metric_normalize_key($k);
        $raw = (string) ($v ?? '');
        if ($pickupDate === '' && preg_match('/^(pickup_date|pu_date|ship_date|pickup_dt|load_date)$/', $nk)) {
            $pickupDate = trim($raw);
        }
        if ($dropoffDate === '' && preg_match('/^(dropoff_date|delivery_date|drop_date|del_date|consignee_date)$/', $nk)) {
            $dropoffDate = trim($raw);
        }
        if ($origin === '' && preg_match('/^(origin|pickup|ship_from|pickup_location|load_at|shipper|pu)$/', $nk)) {
            $origin = $raw;
        }
        if ($destination === '' && preg_match('/^(destination|dest|dropoff|delivery|consignee|unload|drop)$/', $nk)) {
            $destination = $raw;
        }
        if (in_array($nk, ['miles', 'mileage', 'loaded_miles', 'distance'], true)) {
            $miles += norm_number($raw);
        }
        if (metric_key_is_line_haul_rate($nk)) {
            $rate += norm_number($raw);
        }
        if (metric_key_is_dispatcher_fee($nk)) {
            $explicitDisp += norm_number($raw);
        }
        if (in_array($nk, ['amount', 'total'], true)) {
            $fallbackAmt += norm_number($raw);
        }
        if (preg_match('/^(invoice_amount|invoice_total|billed_amount|line_total)$/', $nk)) {
            $invoiceCol += norm_number($raw);
        }
    }

    // Reports: dispatcher fee only from real fee fields or amount/total when they are not the same as line haul.
    // Do NOT substitute line haul (rate) into dispatcher fee — that inflated the fee column.
    $dispatcherFee = $explicitDisp;
    if ($dispatcherFee <= 0.0 && $fallbackAmt > 0.0) {
        if ($rate <= 0.0 || abs($fallbackAmt - $rate) > 0.005) {
            $dispatcherFee = $fallbackAmt;
        }
    }

    if ($invoiceCol > 0.0) {
        $invoiceAmount = $invoiceCol;
    } elseif ($rate > 0.0 && $dispatcherFee > 0.0) {
        $invoiceAmount = $rate + $dispatcherFee;
    } elseif ($rate > 0.0) {
        $invoiceAmount = $rate;
    } else {
        $invoiceAmount = $dispatcherFee;
    }

    $rpm = $miles > 0 ? $rate / $miles : 0.0;

    return [
        'miles' => $miles,
        'rate' => $rate,
        'dispatcherFee' => $dispatcherFee,
        'invoiceAmount' => $invoiceAmount,
        'origin' => $origin,
        'destination' => $destination,
        'pickupDate' => $pickupDate,
        'dropoffDate' => $dropoffDate,
        'rpm' => $rpm,
    ];
}

/**
 * Client-report-only fields stored on invoice row JSON (from PDF extract or manual entry).
 *
 * @param array<string,mixed> $rowData
 * @return array{load_id:string,broker_name:string,commodity:string,weight:string}
 */
function report_row_meta_from_data(array $rowData): array
{
    $norm = [];
    foreach ($rowData as $k => $v) {
        if (!is_scalar($v)) {
            continue;
        }
        $norm[metric_normalize_key($k)] = trim((string) $v);
    }
    $loadId = $norm['load_id'] ?? '';
    if ($loadId === '' && !empty($norm['reference'])) {
        $loadId = $norm['reference'];
    }
    if ($loadId === '' && !empty($norm['load_number'])) {
        $loadId = $norm['load_number'];
    }
    $broker = strtoupper($norm['broker_name'] ?? $norm['broker'] ?? '');
    $broker = preg_replace('/\s+/', ' ', $broker) ?? $broker;
    $commRaw = $norm['commodity'] ?? $norm['commodities'] ?? '';
    $commodity = $commRaw !== ''
        ? strtoupper(preg_replace('/\s+/', ' ', $commRaw) ?? $commRaw)
        : 'FAK';
    $weightRaw = $norm['weight'] ?? $norm['load_weight'] ?? $norm['total_weight'] ?? '';
    $weight = normalize_weight_digits_only((string) $weightRaw);

    return [
        'load_id' => $loadId,
        'broker_name' => $broker,
        'commodity' => $commodity,
        'weight' => $weight,
    ];
}

function week_start_iso(?string $dateInput): ?string
{
    if ($dateInput === null || $dateInput === '') {
        return null;
    }
    $d = strtotime($dateInput);
    if ($d === false) {
        return null;
    }
    $day = (int) date('w', $d);
    $diff = $day === 0 ? -6 : 1 - $day;
    $monday = strtotime(sprintf('%+d days', $diff), $d);
    if ($monday === false) {
        return null;
    }
    return date('Y-m-d', $monday);
}

function uuid_v4(): string
{
    $b = random_bytes(16);
    $b[6] = chr(ord($b[6]) & 0x0f | 0x40);
    $b[8] = chr(ord($b[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/claude_geo.php';

/** @param array<string,mixed> $aiFlat */
function merge_ai_and_regex_php(array $aiFlat): array
{
    $keys = ['origin', 'destination', 'miles', 'reference', 'rate', 'load_id', 'broker_name', 'commodity', 'weight'];
    $extracted = [];
    $confidence = [];
    foreach ($keys as $k) {
        $g = isset($aiFlat[$k]) ? trim((string) $aiFlat[$k]) : '';
        $extracted[$k] = $g !== '' ? $aiFlat[$k] : '';
        $confidence[$k] = $g !== '' ? 0.92 : 0;
    }
    foreach (['pickup_date', 'dropoff_date'] as $dk) {
        $g = isset($aiFlat[$dk]) ? trim((string) $aiFlat[$dk]) : '';
        if ($g !== '') {
            $extracted[$dk] = $aiFlat[$dk];
            $confidence[$dk] = 0.88;
        } else {
            $extracted[$dk] = '';
            $confidence[$dk] = 0;
        }
    }

    return ['extracted' => $extracted, 'confidence' => $confidence];
}

function parse_money_like(mixed $v): float
{
    $s = str_replace(['$', ','], '', trim((string) ($v ?? '')));

    return is_numeric($s) ? (float) $s : 0.0;
}

function compute_rpm_php(mixed $rate, mixed $miles): string
{
    $r = parse_money_like($rate);
    $m = parse_money_like($miles);
    if ($m <= 0 || !is_finite($r)) {
        return '';
    }

    return number_format($r / $m, 3, '.', '');
}

/** @param array<string,mixed> $ex */
function normalize_extracted_display(array $ex): array
{
    $out = $ex;
    foreach (['origin', 'destination', 'reference', 'rate', 'load_id', 'broker_name'] as $k) {
        if (!isset($out[$k])) {
            continue;
        }
        $s = trim((string) $out[$k]);
        $out[$k] = $s !== '' ? strtoupper($s) : '';
    }
    if (isset($out['commodity'])) {
        $c = trim((string) $out['commodity']);
        $out['commodity'] = $c !== '' ? strtoupper($c) : 'FAK';
    } else {
        $out['commodity'] = 'FAK';
    }
    if (isset($out['weight'])) {
        $out['weight'] = normalize_weight_digits_only((string) $out['weight']);
    } else {
        $out['weight'] = '';
    }
    foreach (['pickup_date', 'dropoff_date'] as $k) {
        if (!isset($out[$k])) {
            continue;
        }
        $out[$k] = normalize_iso_date_php((string) $out[$k]);
    }
    if (isset($out['miles'])) {
        $m = str_replace(',', '', (string) $out['miles']);
        if (preg_match('/\d+\.?\d*/', $m, $mm)) {
            $out['miles'] = (string) (int) round((float) $mm[0]);
        } else {
            $out['miles'] = '';
        }
    }
    $rpm = compute_rpm_php($out['rate'] ?? '', $out['miles'] ?? '');
    if ($rpm !== '') {
        $out['rpm'] = $rpm;
    }

    return $out;
}

function has_any_route(array $extracted): bool
{
    foreach (['origin', 'destination', 'reference', 'miles', 'rate'] as $k) {
        if (!empty($extracted[$k]) && trim((string) $extracted[$k]) !== '') {
            return true;
        }
    }

    return false;
}

/** YYYY-MM-DD => sortable int (YYYYMMDD); invalid => null */
function date_sort_key_php(mixed $dateVal): ?int
{
    $s = trim((string) ($dateVal ?? ''));
    if ($s === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
        return null;
    }
    return (int) str_replace('-', '', $s);
}

/** Sort parsed rows by pickup date then dropoff date; undated rows stay last in original order. */
function sort_parse_results_by_dates(array $results): array
{
    $indexed = [];
    foreach ($results as $i => $r) {
        $ex = is_array($r['extracted'] ?? null) ? $r['extracted'] : [];
        $pickup = date_sort_key_php($ex['pickup_date'] ?? null);
        $dropoff = date_sort_key_php($ex['dropoff_date'] ?? null);
        $indexed[] = [
            'idx' => $i,
            'pickup' => $pickup,
            'dropoff' => $dropoff,
            'dated' => ($pickup !== null || $dropoff !== null),
            'row' => $r,
        ];
    }

    usort($indexed, static function ($a, $b): int {
        if ($a['dated'] !== $b['dated']) {
            return $a['dated'] ? -1 : 1;
        }
        if (!$a['dated'] && !$b['dated']) {
            return $a['idx'] <=> $b['idx'];
        }

        $ak1 = $a['pickup'] ?? 99999999;
        $bk1 = $b['pickup'] ?? 99999999;
        if ($ak1 !== $bk1) {
            return $ak1 <=> $bk1;
        }

        $ak2 = $a['dropoff'] ?? 99999999;
        $bk2 = $b['dropoff'] ?? 99999999;
        if ($ak2 !== $bk2) {
            return $ak2 <=> $bk2;
        }

        return $a['idx'] <=> $b['idx'];
    });

    return array_map(static fn ($x) => $x['row'], $indexed);
}

/** @return array<string,mixed> */
function parse_pdf_file_php(string $tmpPath, string $originalName, int $agentId): array
{
    $secrets = $GLOBALS['secrets'];
    $bin = file_get_contents($tmpPath);
    if ($bin === false) {
        return ['ok' => false, 'fileName' => $originalName, 'error' => 'Could not read file'];
    }

    $regexEmpty = [
        'extracted' => [
            'origin' => '', 'destination' => '', 'miles' => '', 'reference' => '', 'rate' => '',
            'load_id' => '', 'broker_name' => '', 'commodity' => '', 'weight' => '',
        ],
        'confidence' => [],
        'rawSnippets' => [],
        'broker' => 'anthropic-pdf',
        'note' => 'Extracted via Claude (PHP, base64 PDF).',
    ];

    $claudeUsed = false;
    $claudeError = null;
    $claudeVia = null;
    $extracted = [];
    $confidence = [];

    $rawResult = anthropic_extract_logistics_pdf($bin, $secrets);
    if ($rawResult === null) {
        return [
            'ok' => false,
            'fileName' => $originalName,
            'warning' => 'ANTHROPIC_API_KEY not set in secrets.php (or Claude disabled). PDF parsing requires Claude on shared hosting.',
            'error' => 'Claude not configured',
            'extracted' => [],
            'confidence' => [],
            'claude' => false,
        ];
    }
    if (isset($rawResult['_error'])) {
        $claudeError = (string) $rawResult['_error'];

        return [
            'ok' => false,
            'fileName' => $originalName,
            'warning' => $claudeError,
            'error' => $claudeError,
            'extracted' => [],
            'confidence' => [],
            'claude' => true,
            'claudeError' => $claudeError,
        ];
    }

    $claudeUsed = true;
    $claudeVia = 'document';
    $app = map_claude_to_app_fields($rawResult);
    $merged = merge_ai_and_regex_php($app);
    $extracted = $merged['extracted'];
    $confidence = $merged['confidence'];

    if (trim((string) ($extracted['miles'] ?? '')) === '' && $app['pickup_city'] && $app['pickup_state'] && $app['dropoff_city'] && $app['dropoff_state']) {
        $est = estimate_loaded_miles_php(
            (string) ($app['pickup_city'] ?? ''),
            (string) ($app['pickup_state'] ?? ''),
            (string) ($app['dropoff_city'] ?? ''),
            (string) ($app['dropoff_state'] ?? ''),
            (string) ($app['pickup_address'] ?? ''),
            (string) ($app['dropoff_address'] ?? '')
        );
        if ($est !== '') {
            $extracted['miles'] = $est;
            $confidence['miles'] = 0.72;
        }
    }
    $rpm = compute_rpm_php($extracted['rate'] ?? '', $extracted['miles'] ?? '');
    if ($rpm !== '') {
        $extracted['rpm'] = $rpm;
        $confidence['rpm'] = 0.98;
    }

    if (!has_any_route($extracted)) {
        return [
            'ok' => false,
            'fileName' => $originalName,
            'extracted' => [],
            'confidence' => [],
            'broker' => 'generic',
            'warning' => 'Claude returned no usable pickup/dropoff, miles, or rate.',
            'claude' => true,
            'claudeError' => $claudeError,
        ];
    }

    $norm = normalize_extracted_display($extracted);
    $relPath = 'uploads/' . time() . '-' . bin2hex(random_bytes(4)) . '.pdf';
    $dest = $GLOBALS['public_root'] . '/' . $relPath;
    @copy($tmpPath, $dest);

    try {
        $ins = db()->prepare(
            'INSERT INTO uploads (agent_id, original_name, file_path, extracted_data, confidence_scores) VALUES (?,?,?,?,?)'
        );
        $ins->execute([
            $agentId,
            $originalName,
            '/' . $relPath,
            json_encode($norm),
            json_encode($confidence),
        ]);
        $uploadId = (int) db()->lastInsertId();
    } catch (Throwable $e) {
        $uploadId = null;
    }

    return [
        'ok' => true,
        'fileName' => $originalName,
        'extracted' => $norm,
        'confidence' => $confidence,
        'rawSnippets' => [],
        'broker' => $regexEmpty['broker'],
        'textLength' => 0,
        'note' => $regexEmpty['note'],
        'uploadId' => $uploadId,
        'sparse' => false,
        'sparseReason' => '',
        'claude' => $claudeUsed,
        'claudeVia' => $claudeVia,
        'claudeError' => $claudeError,
    ];
}

function handle_upload(string $method, array $parts): void
{
    $sub = $parts[0] ?? '';

    if ($method === 'POST' && $sub === 'parse') {
        require_login();
        if (empty($_FILES['ratecon'])) {
            json_response(['error' => 'No PDF files uploaded'], 400);
        }
        $f = $_FILES['ratecon'];
        $results = [];
        if (is_array($f['name'])) {
            $n = count($f['name']);
            for ($i = 0; $i < $n; $i++) {
                if (($f['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                    $results[] = [
                        'ok' => false,
                        'fileName' => $f['name'][$i] ?? 'file',
                        'error' => 'Upload error',
                    ];
                    continue;
                }
                $results[] = parse_pdf_file_php(
                    (string) $f['tmp_name'][$i],
                    (string) $f['name'][$i],
                    (int) $_SESSION['user_id']
                );
            }
        } else {
            if ($f['error'] !== UPLOAD_ERR_OK) {
                json_response(['error' => 'Upload failed'], 400);
            }
            $results[] = parse_pdf_file_php(
                (string) $f['tmp_name'],
                (string) $f['name'],
                (int) $_SESSION['user_id']
            );
        }

        if (count($results) === 1) {
            json_response($results[0]);
        }
        $sortedResults = sort_parse_results_by_dates($results);
        json_response(['batch' => true, 'count' => count($sortedResults), 'results' => $sortedResults]);
    }

    if ($method === 'POST' && $sub === 'logo') {
        require_admin();
        if (empty($_FILES['logo']) || $_FILES['logo']['error'] !== UPLOAD_ERR_OK) {
            json_response(['error' => 'No image uploaded'], 400);
        }
        $dir = $GLOBALS['public_root'] . '/assets/logos';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $ext = strtolower(pathinfo($_FILES['logo']['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp'], true)) {
            json_response(['error' => 'Invalid image type'], 400);
        }
        $fn = 'logo.' . ($ext === 'jpeg' ? 'jpg' : $ext);
        $target = $dir . '/' . $fn;
        if (!move_uploaded_file($_FILES['logo']['tmp_name'], $target)) {
            json_response(['error' => 'Could not save logo'], 500);
        }
        $logoPath = '/assets/logos/' . $fn;
        $ex = db()->query('SELECT id FROM company_settings LIMIT 1')->fetch();
        if ($ex) {
            db()->prepare('UPDATE company_settings SET logo_path = ? WHERE id = ?')->execute([$logoPath, $ex['id']]);
        } else {
            db()->prepare('INSERT INTO company_settings (logo_path) VALUES (?)')->execute([$logoPath]);
        }
        json_response(['success' => true, 'logoPath' => $logoPath, 'logo_path' => $logoPath]);

        return;
    }

    json_response(['error' => 'Not found'], 404);
}

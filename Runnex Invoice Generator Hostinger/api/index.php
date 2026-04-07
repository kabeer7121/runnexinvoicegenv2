<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

require_once __DIR__ . '/handlers/auth.php';
require_once __DIR__ . '/handlers/clients.php';
require_once __DIR__ . '/handlers/agents.php';
require_once __DIR__ . '/handlers/templates.php';
require_once __DIR__ . '/handlers/company.php';
require_once __DIR__ . '/handlers/payment_accounts.php';
require_once __DIR__ . '/handlers/invoices.php';
require_once __DIR__ . '/handlers/upload.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (!is_string($path) || $path === '') {
    $path = '/';
}
$path = rawurldecode($path);

$script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? ''));
$apiPrefix = dirname($script);
if ($apiPrefix === '' || $apiPrefix === '.') {
    $apiPrefix = '/api';
}

if (!empty($secrets['api_path_prefix'])) {
    $apiPrefix = (string) $secrets['api_path_prefix'];
}

if ($apiPrefix !== '' && $apiPrefix[0] !== '/') {
    $apiPrefix = '/' . $apiPrefix;
}
$apiPrefix = rtrim($apiPrefix, '/');

if ($apiPrefix === '') {
    json_response(['error' => 'Invalid API path configuration'], 500);
}

if (!str_starts_with($path, $apiPrefix)) {
    json_response(['error' => 'Not found'], 404);
}

$rest = ltrim(substr($path, strlen($apiPrefix)), '/');
$segments = $rest === '' ? [] : explode('/', $rest);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$resource = $segments[0] ?? '';
$parts = array_slice($segments, 1);

if ($resource === '') {
    if ($method === 'GET') {
        json_response(['ok' => true, 'service' => 'invoice-pilot-api']);
    }
    json_response(['error' => 'Not found'], 404);
}

switch ($resource) {
    case 'auth':
        handle_auth($method, $parts);
        break;
    case 'clients':
        handle_clients($method, $parts);
        break;
    case 'agents':
        handle_agents($method, $parts);
        break;
    case 'templates':
        handle_templates($method, $parts);
        break;
    case 'company':
        handle_company($method, $parts);
        break;
    case 'payment-accounts':
        handle_payment_accounts($method, $parts);
        break;
    case 'invoices':
        handle_invoices($method, $parts);
        break;
    case 'upload':
        handle_upload($method, $parts);
        break;
    default:
        json_response(['error' => 'Not found'], 404);
}

<?php
declare(strict_types=1);

$secretsFile = __DIR__ . '/secrets.php';
if (!is_readable($secretsFile)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'Server not configured. Copy secrets.sample.php to secrets.php and set MySQL + options.',
    ]);
    exit;
}

/** @var array<string,mixed> $secrets */
$secrets = require $secretsFile;
$envAnthropic = getenv('ANTHROPIC_API_KEY');
if (is_string($envAnthropic) && trim($envAnthropic) !== '' && trim((string) ($secrets['anthropic_api_key'] ?? '')) === '') {
    $secrets['anthropic_api_key'] = $envAnthropic;
}
$GLOBALS['secrets'] = $secrets;

require_once __DIR__ . '/lib/helpers.php';

$dsn = sprintf(
    'mysql:host=%s;dbname=%s;charset=utf8mb4',
    $secrets['db_host'] ?? 'localhost',
    $secrets['db_name'] ?? ''
);
try {
    $pdo = new PDO($dsn, $secrets['db_user'] ?? '', $secrets['db_pass'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Throwable $e) {
    json_response(['error' => 'Database connection failed'], 500);
}

$GLOBALS['pdo'] = $pdo;
$GLOBALS['secrets'] = $secrets;

// Document root parent (folder containing api/, admin.html, assets/)
$GLOBALS['public_root'] = dirname(__DIR__);

$uploads = $GLOBALS['public_root'] . '/uploads';
if (!is_dir($uploads)) {
    @mkdir($uploads, 0755, true);
}

/** CORS for /api when front-end calls same host — no extra headers needed */

session_name('ip_sess');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => !empty($secrets['cookie_secure']),
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

/** @return PDO */
function db(): PDO
{
    return $GLOBALS['pdo'];
}

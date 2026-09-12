<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

$root = dirname(__DIR__, 2);
load_env($root . '/api/.env');
load_env($root . '/.env');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

require_setup_token();

$schemaPath = $root . '/api/schema.sql';
if (!is_file($schemaPath)) {
    json_response([
        'ok' => false,
        'error' => 'schema_not_found',
        'message' => 'Khong tim thay api/schema.sql.'
    ], 500);
}

$pdo = db();
if (!$pdo) {
    json_response([
        'ok' => false,
        'error' => 'db_not_configured',
        'message' => 'Chua cau hinh DB_HOST/DB_NAME/DB_USER/DB_PASSWORD hoac khong ket noi duoc MySQL.'
    ], 500);
}

$schema = (string) file_get_contents($schemaPath);
$statements = array_values(array_filter(array_map('trim', preg_split('/;\s*(?:\r?\n|$)/', $schema) ?: [])));
$executed = 0;

try {
    foreach ($statements as $statement) {
        if ($statement === '') {
            continue;
        }
        $pdo->exec($statement);
        $executed++;
    }
    $executed += ensure_account_schema($pdo);
} catch (Throwable $error) {
    json_response([
        'ok' => false,
        'error' => 'schema_failed',
        'message' => $error->getMessage(),
        'executed' => $executed,
    ], 500);
}

json_response([
    'ok' => true,
    'message' => 'Da tao/cap nhat bang MySQL cho landing.',
    'executed' => $executed,
    'generatedAt' => gmdate('c'),
]);

function ensure_account_schema(PDO $pdo): int
{
    $statements = [
        'ALTER TABLE customers MODIFY phone VARCHAR(32) NULL',
        'ALTER TABLE customers ADD COLUMN username VARCHAR(64) NULL AFTER google_email',
        'ALTER TABLE customers ADD COLUMN email VARCHAR(190) NULL AFTER username',
        'ALTER TABLE customers ADD COLUMN password_hash VARCHAR(255) NULL AFTER email',
        'ALTER TABLE customers ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash',
        'ALTER TABLE customers ADD COLUMN reset_token_hash VARCHAR(128) NULL AFTER email_verified',
        'ALTER TABLE customers ADD COLUMN reset_token_expires_at DATETIME NULL AFTER reset_token_hash',
        'ALTER TABLE customers ADD COLUMN date_of_birth DATE NULL AFTER name',
        'ALTER TABLE customers ADD COLUMN gender VARCHAR(32) NOT NULL DEFAULT \'\' AFTER date_of_birth',
        'ALTER TABLE customers ADD UNIQUE KEY uniq_customers_username (username)',
        'ALTER TABLE customers ADD UNIQUE KEY uniq_customers_email (email)',
        'ALTER TABLE customers ADD KEY idx_customers_reset_token (reset_token_hash)',
    ];
    $executed = 0;
    foreach ($statements as $statement) {
        try {
            $pdo->exec($statement);
            $executed++;
        } catch (Throwable $error) {
            $code = (int) ($error->errorInfo[1] ?? 0);
            if (!in_array($code, [1060, 1061], true)) {
                error_log('TopRun account schema migration skipped: ' . $error->getMessage());
            }
        }
    }
    return $executed;
}

function require_setup_token(): void
{
    $adminToken = trim((string) getenv('LANDING_ADMIN_TOKEN'));
    $ordersToken = trim((string) getenv('LANDING_ORDERS_TOKEN'));
    $supplied = supplied_token();
    if ($supplied === '' || (($adminToken === '' || !hash_equals($adminToken, $supplied)) && ($ordersToken === '' || !hash_equals($ordersToken, $supplied)))) {
        json_response([
            'ok' => false,
            'error' => 'setup_token_required',
            'message' => 'Can LANDING_ADMIN_TOKEN hoac LANDING_ORDERS_TOKEN de setup database.'
        ], 401);
    }
}

function supplied_token(): string
{
    $authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    $bearer = preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches) ? trim($matches[1]) : '';
    if ($bearer !== '') {
        return $bearer;
    }
    if (!empty($_SERVER['HTTP_X_TOPRUN_ADMIN_TOKEN'])) {
        return trim((string) $_SERVER['HTTP_X_TOPRUN_ADMIN_TOKEN']);
    }
    return trim((string) ($_GET['token'] ?? ''));
}

function db(): ?PDO
{
    $host = trim((string) getenv('DB_HOST'));
    $name = trim((string) getenv('DB_NAME'));
    $user = trim((string) getenv('DB_USER'));
    $pass = (string) getenv('DB_PASSWORD');
    if ($host === '' || $name === '' || $user === '') {
        return null;
    }
    try {
        return new PDO('mysql:host=' . $host . ';dbname=' . $name . ';charset=utf8mb4', $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (Throwable $error) {
        error_log('TopRun setup DB connection failed: ' . $error->getMessage());
        return null;
    }
}

function load_env(string $path): void
{
    if (!is_file($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0) continue;
        $separator = strpos($line, '=');
        if ($separator === false || $separator <= 0) continue;
        $key = trim(substr($line, 0, $separator));
        $value = trim(substr($line, $separator + 1));
        if ((strpos($value, '"') === 0 && substr($value, -1) === '"') || (strpos($value, "'") === 0 && substr($value, -1) === "'")) {
            $value = substr($value, 1, -1);
        }
        if (getenv($key) === false) {
            putenv($key . '=' . $value);
            $_ENV[$key] = $value;
        }
    }
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

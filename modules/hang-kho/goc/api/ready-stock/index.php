<?php
declare(strict_types=1);

// Kho hang san (ready-stock) 2026-08-11 — CHI-CO-O-TOPRUN.
// PHP chi la fallback doc/503: moi thao tac ghi (sync) phai di qua Node server.js.

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

$root = dirname(__DIR__, 2);
load_env($root . '/api/.env');
load_env($root . '/.env');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = $root . '/data/ready-stock.json';

if ($method === 'GET') {
    require_admin_token();
    json_response(read_ready_stock_payload($path));
}

json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);

function read_ready_stock_payload(string $path): array
{
    $fallback = [
        'version' => 1,
        'revision' => 0,
        'updatedAt' => '',
        'policy' => ['summaryText' => '', 'codAllowed' => true, 'depositPercent' => 0],
        'branches' => [],
        'products' => [],
        'pendingSales' => [],
    ];
    if (!is_file($path)) return $fallback;
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? array_merge($fallback, $decoded) : $fallback;
}

function require_admin_token(): void
{
    $adminToken = trim((string) getenv('LANDING_ADMIN_TOKEN'));
    $ordersToken = trim((string) getenv('LANDING_ORDERS_TOKEN'));
    $supplied = supplied_token();
    if ($supplied === '' || (($adminToken === '' || !hash_equals($adminToken, $supplied)) && ($ordersToken === '' || !hash_equals($ordersToken, $supplied)))) {
        json_response([
            'ok' => false,
            'error' => 'admin_token_required',
            'message' => 'Can LANDING_ADMIN_TOKEN hoac LANDING_ORDERS_TOKEN de doc kho hang san.',
        ], 401);
    }
}

function supplied_token(): string
{
    $authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) return trim($matches[1]);
    foreach (['HTTP_X_TOPRUN_ADMIN_TOKEN', 'HTTP_X_TOPRUN_ORDERS_TOKEN', 'HTTP_X_LANDING_ORDERS_TOKEN'] as $key) {
        if (!empty($_SERVER[$key])) return trim((string) $_SERVER[$key]);
    }
    return trim((string) ($_GET['token'] ?? ''));
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

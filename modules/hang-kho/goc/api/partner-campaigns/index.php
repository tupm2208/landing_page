<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

$root = dirname(__DIR__, 2);
load_env($root . '/api/.env');
load_env($root . '/.env');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = $root . '/data/partner-campaigns.json';

if ($method === 'GET') {
    json_response(read_campaign_payload($path));
}

if ($method === 'POST' || $method === 'PUT') {
    require_admin_token();
    $payload = read_request_json();
    $normalized = normalize_campaign_payload($payload);
    ensure_data_dir(dirname($path));
    if (file_put_contents($path, json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) === false) {
        json_response([
            'ok' => false,
            'error' => 'write_failed',
            'message' => 'Khong ghi duoc data/partner-campaigns.json.',
        ], 500);
    }
    json_response([
        'ok' => true,
        'campaigns' => count($normalized['campaigns']),
        'products' => count($normalized['products']),
        'updatedAt' => $normalized['updatedAt'],
    ]);
}

json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);

function normalize_campaign_payload(array $payload): array
{
    $campaigns = array_values(array_filter(array_map(function ($item) {
        if (!is_array($item)) return null;
        $id = trim((string) ($item['id'] ?? $item['campaignId'] ?? ''));
        $name = trim((string) ($item['name'] ?? $item['campaignName'] ?? $item['promotionText'] ?? 'Partner campaign'));
        if ($id === '') {
            $id = stable_id($name);
        }
        if ($id === '') return null;
        return array_merge($item, [
            'id' => $id,
            'name' => $name !== '' ? $name : 'Partner campaign',
            'status' => strtolower(trim((string) ($item['status'] ?? 'active'))) === 'paused' ? 'paused' : 'active',
        ]);
    }, is_array($payload['campaigns'] ?? null) ? $payload['campaigns'] : [])));

    $campaignIds = [];
    foreach ($campaigns as $campaign) {
        $campaignIds[(string) $campaign['id']] = true;
    }

    $products = array_values(array_filter(array_map(function ($item) use ($campaignIds) {
        if (!is_array($item)) return null;
        $code = trim((string) ($item['code'] ?? $item['productCode'] ?? ''));
        $name = trim((string) ($item['name'] ?? $item['productName'] ?? $code));
        if ($code === '' || $name === '') return null;
        $campaignId = trim((string) ($item['campaignId'] ?? ''));
        if ($campaignId !== '' && $campaignIds && empty($campaignIds[$campaignId])) return null;
        $sizes = array_values(array_filter(array_map(function ($row) {
            if (!is_array($row)) return null;
            $size = trim((string) ($row['size'] ?? ''));
            if ($size === '') return null;
            $qty = numeric_value($row['qty'] ?? $row['stockQty'] ?? $row['quantity'] ?? 0);
            return array_merge($row, [
                'size' => $size,
                'qty' => max(0, $qty),
            ]);
        }, is_array($item['sizes'] ?? null) ? $item['sizes'] : [])));
        if (!$sizes) return null;
        return array_merge($item, [
            'code' => $code,
            'productCode' => $code,
            'name' => $name,
            'sizes' => $sizes,
        ]);
    }, is_array($payload['products'] ?? null) ? $payload['products'] : [])));

    return [
        'version' => 1,
        'source' => 'partner_campaign_snapshot',
        'updatedAt' => trim((string) ($payload['updatedAt'] ?? '')) ?: gmdate('c'),
        'campaigns' => $campaigns,
        'products' => $products,
    ];
}

function read_campaign_payload(string $path): array
{
    $fallback = [
        'version' => 1,
        'source' => 'partner_campaign_snapshot',
        'updatedAt' => '',
        'campaigns' => [],
        'products' => [],
    ];
    if (!is_file($path)) return $fallback;
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? array_merge($fallback, $decoded) : $fallback;
}

function read_request_json(): array
{
    $raw = (string) file_get_contents('php://input');
    if (strlen($raw) > 5 * 1024 * 1024) {
        json_response(['ok' => false, 'error' => 'payload_too_large'], 413);
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        json_response(['ok' => false, 'error' => 'invalid_json'], 400);
    }
    return $decoded;
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
            'message' => 'Can LANDING_ADMIN_TOKEN hoac LANDING_ORDERS_TOKEN de cap nhat campaign doi tac.',
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

function ensure_data_dir(string $dir): void
{
    if (is_dir($dir)) return;
    if (!mkdir($dir, 0755, true) && !is_dir($dir)) {
        json_response(['ok' => false, 'error' => 'data_dir_failed'], 500);
    }
}

function numeric_value($value): float
{
    if (is_int($value) || is_float($value)) return (float) $value;
    $clean = preg_replace('/[^\d.\-]/', '', (string) $value);
    if ($clean === '' || $clean === null) return 0.0;
    return is_numeric($clean) ? (float) $clean : 0.0;
}

function stable_id(string $value): string
{
    $text = strtolower(trim($value));
    $text = preg_replace('/[^a-z0-9]+/', '_', $text);
    return trim((string) $text, '_');
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

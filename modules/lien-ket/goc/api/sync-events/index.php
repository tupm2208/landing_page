<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

$root = dirname(__DIR__, 2);
load_env($root . '/api/.env');
load_env($root . '/.env');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    json_response(['ok' => false, 'error' => 'method_not_allowed', 'message' => 'Method not allowed.'], 405);
}

require_admin_token();

$data = read_sync_events($root . '/data/sync-events.json');
$portal = read_json_file($root . '/data/partner-portal.json', ['procurementPurchases' => []]);
$since = trim((string) ($_GET['since'] ?? ''));
$type = trim((string) ($_GET['type'] ?? ''));
$limit = max(1, min(500, (int) ($_GET['limit'] ?? 200)));
$sourceEvents = array_merge(
    is_array($data['events'] ?? null) ? $data['events'] : [],
    ($type === '' || $type === 'partner_purchase.created') ? partner_purchase_sync_events($portal) : []
);
$events = sync_events_since(unique_sync_events($sourceEvents), $since, $type, $limit);

json_response([
    'ok' => true,
    'events' => $events,
    'cursor' => count($events) ? (string) ($events[count($events) - 1]['createdAt'] ?? $events[count($events) - 1]['eventId'] ?? '') : $since,
    'updatedAt' => (string) ($data['updatedAt'] ?? ''),
]);

function sync_events_since(array $events, string $since, string $type, int $limit): array
{
    $filtered = array_values(array_filter($events, function ($event) use ($since, $type) {
        if (!is_array($event)) return false;
        if ($type !== '' && (string) ($event['type'] ?? '') !== $type) return false;
        if ($since === '') return true;
        if (starts_with($since, 'evt_')) return (string) ($event['eventId'] ?? '') > $since;
        return (string) ($event['createdAt'] ?? '') > $since;
    }));
    usort($filtered, function ($a, $b) {
        $created = strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? ''));
        if ($created !== 0) return $created;
        return strcmp((string) ($a['eventId'] ?? ''), (string) ($b['eventId'] ?? ''));
    });
    return array_slice($filtered, -$limit);
}

function unique_sync_events(array $events): array
{
    $seen = [];
    $result = [];
    foreach ($events as $event) {
        if (!is_array($event)) continue;
        $eventType = (string) ($event['type'] ?? '');
        $isAdminOperation = starts_with($eventType, 'admin_order.');
        $key = $isAdminOperation
            ? ((string) ($event['eventId'] ?? '') ?: ($eventType . ':' . (string) ($event['createdAt'] ?? '')))
            : (!empty($event['entityId'])
            ? (string) ($event['type'] ?? '') . ':' . (string) $event['entityId']
            : ((string) ($event['eventId'] ?? '') ?: ($eventType . ':' . (string) ($event['createdAt'] ?? ''))));
        if ($key === '' || isset($seen[$key])) continue;
        $seen[$key] = true;
        $result[] = $event;
    }
    return $result;
}

function partner_purchase_sync_events(array $portal): array
{
    $events = [];
    $purchases = is_array($portal['procurementPurchases'] ?? null) ? $portal['procurementPurchases'] : [];
    foreach ($purchases as $session) {
        if (!is_array($session) || empty($session['id'])) continue;
        $createdAt = (string) ($session['createdAt'] ?? $session['updatedAt'] ?? $portal['updatedAt'] ?? $portal['syncedAt'] ?? '');
        if ($createdAt === '') continue;
        $allocations = is_array($session['allocations'] ?? null) ? $session['allocations'] : [];
        $orderIds = array_values(array_unique(array_filter(array_map(function ($item) {
            return is_array($item) ? (string) ($item['orderId'] ?? '') : '';
        }, $allocations))));
        $events[] = [
            'eventId' => 'evt_purchase_' . (string) $session['id'],
            'type' => 'partner_purchase.created',
            'entityType' => 'procurementPurchase',
            'entityId' => (string) $session['id'],
            'source' => (string) ($session['source'] ?? 'partner_portal'),
            'createdAt' => $createdAt,
            'payload' => [
                'session' => $session,
                'orderIds' => $orderIds,
                'partnerId' => (string) ($session['partnerId'] ?? ''),
                'productCode' => (string) ($session['productCode'] ?? ''),
                'size' => (string) ($session['size'] ?? ''),
                'quantity' => $session['quantity'] ?? 0,
            ],
        ];
    }
    return $events;
}

function read_json_file(string $path, array $fallback): array
{
    if (!is_file($path)) return $fallback;
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? $decoded : $fallback;
}

function read_sync_events(string $path): array
{
    $fallback = ['version' => 1, 'events' => [], 'updatedAt' => ''];
    if (!is_file($path)) return $fallback;
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? array_merge($fallback, $decoded) : $fallback;
}

function require_admin_token(): void
{
    $token = trim((string) getenv('LANDING_ADMIN_TOKEN'));
    if ($token === '') $token = trim((string) getenv('LANDING_ORDERS_TOKEN'));
    if ($token === '' || !hash_equals($token, supplied_token())) {
        json_response(['ok' => false, 'error' => 'admin_token_required', 'message' => 'Can token admin/orders de doc thay doi landing.'], 401);
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
        if ($line === '' || starts_with($line, '#')) continue;
        $separator = strpos($line, '=');
        if ($separator === false || $separator <= 0) continue;
        $key = trim(substr($line, 0, $separator));
        $value = trim(substr($line, $separator + 1));
        if ((starts_with($value, '"') && ends_with($value, '"')) || (starts_with($value, "'") && ends_with($value, "'"))) {
            $value = substr($value, 1, -1);
        }
        if (getenv($key) === false) {
            putenv($key . '=' . $value);
            $_ENV[$key] = $value;
        }
    }
}

function starts_with(string $value, string $needle): bool
{
    return $needle === '' || strpos($value, $needle) === 0;
}

function ends_with(string $value, string $needle): bool
{
    if ($needle === '') return true;
    return substr($value, -strlen($needle)) === $needle;
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

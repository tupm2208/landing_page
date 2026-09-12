<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

// Link chia se bo loc /l/<token>: token la base64url cua query string bo loc
// (link thuan ASCII de Facebook/Messenger khong cat mat query khi khach gui link).
const SHARE_LINK_ALLOWED_KEYS = [
    'q', 'query', 'size', 'gender', 'sport', 'category', 'type', 'division',
    'brand', 'warehouse', 'price_min', 'price_max', 'sale', 'ban', 'sort',
];

function share_link_target(string $token): string
{
    if (!preg_match('/^[A-Za-z0-9_-]{1,700}$/', $token)) {
        return '/';
    }
    $base64 = strtr($token, '-_', '+/');
    $padding = strlen($base64) % 4;
    if ($padding !== 0) {
        $base64 .= str_repeat('=', 4 - $padding);
    }
    $decoded = base64_decode($base64, true);
    if ($decoded === false || $decoded === '' || preg_match('/[\x00-\x1f<>"\'\\\\]/', $decoded)) {
        return '/';
    }
    parse_str($decoded, $params);
    $clean = [];
    foreach ($params as $key => $value) {
        if (!is_string($key) || !is_string($value)) {
            continue;
        }
        if (!in_array($key, SHARE_LINK_ALLOWED_KEYS, true)) {
            continue;
        }
        $value = trim($value);
        if ($value === '' || strlen($value) > 200) {
            continue;
        }
        $clean[$key] = $value;
    }
    if ($clean === []) {
        return '/';
    }
    return '/?' . http_build_query($clean, '', '&', PHP_QUERY_RFC3986);
}

$target = share_link_target(trim((string) ($_GET['t'] ?? '')));
header('Cache-Control: public, max-age=300');
header('X-Robots-Tag: noindex');
header('Location: ' . $target, true, 302);
exit;

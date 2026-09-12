<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

$root = dirname(__DIR__, 3);
load_env($root . '/api/.env');
load_env($root . '/.env');

json_response([
    'ok' => true,
    'firebase' => [
        'apiKey' => trim((string) getenv('FIREBASE_API_KEY')),
        'authDomain' => trim((string) getenv('FIREBASE_AUTH_DOMAIN')),
        'projectId' => trim((string) getenv('FIREBASE_PROJECT_ID')),
    ],
]);

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

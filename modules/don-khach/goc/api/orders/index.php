<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

$root = dirname(__DIR__, 2);
load_env($root . '/api/.env');
load_env($root . '/.env');

$ordersPath = $root . '/data/orders.json';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    handle_get_orders($ordersPath);
}

if ($method === 'POST') {
    handle_post_order($ordersPath);
}

json_response([
    'ok' => false,
    'error' => 'method_not_allowed',
    'message' => 'Method not allowed.'
], 405);

function handle_get_orders(string $ordersPath): void
{
    require_orders_token();
    $since = trim((string) ($_GET['since'] ?? ''));
    $orders = list_orders($ordersPath, $since);

    json_response([
        'ok' => true,
        'data' => $orders,
        'count' => count($orders),
        'storage' => storage_mode(),
        'generatedAt' => gmdate('c')
    ]);
}

function handle_post_order(string $ordersPath): void
{
    $body = read_request_json();
    $order = build_order_from_payload($body);
    $validation = validate_order($order);
    if ($validation !== '') {
        json_response([
            'ok' => false,
            'error' => 'invalid_order',
            'message' => $validation,
        ], 422);
    }

    save_order($ordersPath, $order);

    $telegramSync = send_order_to_telegram($order);
    $sheetSync = append_order_to_google_sheet($order);

    json_response([
        'ok' => true,
        'order' => $order,
        'sheetSync' => $sheetSync,
        'telegramSync' => $telegramSync,
        'accountPrompt' => [
            'enabled' => true,
            'phone' => $order['phone'],
            'message' => 'Ban co muon tao tai khoan bang so dien thoai nay de theo doi don hang va nhan uu dai sale khong?'
        ],
    ]);
}

function build_order_from_payload(array $body): array
{
    $items = [];
    if (isset($body['items']) && is_array($body['items'])) {
        foreach ($body['items'] as $item) {
            $normalized = normalize_order_item(is_array($item) ? $item : []);
            if ($normalized !== null) {
                $items[] = $normalized;
            }
        }
    }

    if (!count($items) && !empty($body['productCode'])) {
        $normalized = normalize_order_item([
            'productCode' => $body['productCode'] ?? '',
            'productName' => $body['productName'] ?? '',
            'size' => $body['size'] ?? '',
            'price' => $body['price'] ?? 0,
            'qty' => 1,
        ]);
        if ($normalized !== null) {
            $items[] = $normalized;
        }
    }

    $computedTotal = 0;
    foreach ($items as $item) {
        $computedTotal += ((float) $item['price']) * ((int) $item['qty']);
    }

    $province = trim((string) ($body['province'] ?? $body['city'] ?? ''));
    $district = trim((string) ($body['district'] ?? ''));
    $ward = trim((string) ($body['ward'] ?? ''));
    $addressDetail = trim((string) ($body['addressDetail'] ?? $body['detailAddress'] ?? ''));
    $address = trim((string) ($body['address'] ?? ''));
    if ($address === '') {
        $address = full_address($addressDetail, $ward, $district, $province);
    }

    $now = gmdate('c');
    $order = [
        'id' => make_order_id(),
        'createdAt' => $now,
        'updatedAt' => $now,
        'items' => $items,
        'total' => number_value($body['total'] ?? $computedTotal, $computedTotal),
        'customerName' => trim((string) ($body['customerName'] ?? $body['name'] ?? '')),
        'phone' => normalize_phone((string) ($body['phone'] ?? '')),
        'address' => $address,
        'province' => $province,
        'district' => $district,
        'ward' => $ward,
        'addressDetail' => $addressDetail,
        'note' => trim((string) ($body['note'] ?? '')),
        'status' => 'pending',
        'paymentStatus' => 'payment_pending',
        'fulfillmentStatus' => 'not_assigned',
        'warehouseId' => null,
        'shippingProvider' => '',
        'trackingCode' => '',
        'canCancelUntil' => gmdate('c', time() + 15 * 60),
        'cancelledAt' => null,
        'customer' => [
            'name' => trim((string) ($body['customerName'] ?? $body['name'] ?? '')),
            'phone' => normalize_phone((string) ($body['phone'] ?? '')),
            'address' => $address,
            'province' => $province,
            'district' => $district,
            'ward' => $ward,
            'addressDetail' => $addressDetail,
            'wantsAccount' => (bool) ($body['wantsAccount'] ?? false),
            'marketingOptIn' => (bool) ($body['marketingOptIn'] ?? true),
        ],
    ];

    return $order;
}

function validate_order(array $order): string
{
    if (!count($order['items'])) {
        return 'Don hang can it nhat mot san pham.';
    }
    if ($order['customerName'] === '') {
        return 'Vui long nhap ten khach hang.';
    }
    if ($order['phone'] === '') {
        return 'Vui long nhap so dien thoai.';
    }
    if (!preg_match('/^(0|\+84)(3|5|7|8|9)\d{8}$/', normalize_phone((string) $order['phone']))) {
        return 'So dien thoai chua dung dinh dang Viet Nam.';
    }
    foreach (['province' => 'Tinh/TP', 'district' => 'Huyen/Quan', 'ward' => 'Xa/Phuong', 'addressDetail' => 'Dia chi chi tiet'] as $key => $label) {
        if (trim((string) ($order[$key] ?? '')) === '') {
            return 'Vui long nhap ' . $label . '.';
        }
    }
    return '';
}

function normalize_order_item(array $item): ?array
{
    $productCode = trim((string) ($item['productCode'] ?? $item['code'] ?? $item['sku'] ?? ''));
    $productName = trim((string) ($item['productName'] ?? $item['name'] ?? $item['title'] ?? ''));
    if ($productCode === '' && $productName === '') {
        return null;
    }

    return [
        'productCode' => $productCode,
        'productName' => $productName !== '' ? $productName : $productCode,
        'size' => trim((string) ($item['size'] ?? $item['variant'] ?? $item['option'] ?? '')),
        'qty' => max(1, (int) number_value($item['qty'] ?? $item['quantity'] ?? 1, 1)),
        'price' => max(0, number_value($item['price'] ?? $item['salePrice'] ?? $item['suggestedPrice'] ?? 0, 0)),
        'source' => trim((string) ($item['source'] ?? '')),
        'sourceName' => trim((string) ($item['sourceName'] ?? '')),
        'imageUrl' => trim((string) ($item['imageUrl'] ?? $item['image'] ?? $item['thumbnailImage'] ?? $item['highImage'] ?? '')),
    ];
}

function list_orders(string $ordersPath, string $since = ''): array
{
    $pdo = db();
    if ($pdo) {
        $sql = 'SELECT * FROM orders';
        $params = [];
        if ($since !== '') {
            $sql .= ' WHERE created_at > ?';
            $params[] = mysql_datetime($since);
        }
        $sql .= ' ORDER BY created_at DESC LIMIT 500';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $orders = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $orders[] = order_from_db_row($pdo, $row);
        }
        return $orders;
    }

    $orders = read_json_file($ordersPath, []);
    if ($since !== '') {
        $orders = array_values(array_filter($orders, function ($order) use ($since) {
            return strcmp((string) ($order['createdAt'] ?? ''), $since) > 0;
        }));
    }
    return $orders;
}

function save_order(string $ordersPath, array $order): void
{
    $pdo = db();
    if ($pdo) {
        save_order_to_db($pdo, $order);
        return;
    }

    $orders = read_json_file($ordersPath, []);
    array_unshift($orders, $order);
    ensure_data_dir(dirname($ordersPath));
    file_put_contents($ordersPath, json_encode($orders, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function save_order_to_db(PDO $pdo, array $order): void
{
    $pdo->beginTransaction();
    try {
        $customerId = upsert_customer($pdo, $order['customer']);
        $addressId = upsert_customer_address($pdo, $customerId, $order);
        $stmt = $pdo->prepare(
            'INSERT INTO orders (
                id, customer_id, customer_address_id, customer_name, phone, address, province, district, ward, address_detail,
                note, total, status, payment_status, fulfillment_status, warehouse_id, shipping_provider, tracking_code,
                can_cancel_until, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $order['id'],
            $customerId,
            $addressId,
            $order['customerName'],
            $order['phone'],
            $order['address'],
            $order['province'],
            $order['district'],
            $order['ward'],
            $order['addressDetail'],
            $order['note'],
            $order['total'],
            $order['status'],
            $order['paymentStatus'],
            $order['fulfillmentStatus'],
            $order['warehouseId'],
            $order['shippingProvider'],
            $order['trackingCode'],
            mysql_datetime($order['canCancelUntil']),
            mysql_datetime($order['createdAt']),
            mysql_datetime($order['updatedAt']),
        ]);

        $line = 1;
        $itemStmt = $pdo->prepare(
            'INSERT INTO order_items (order_id, line_no, product_code, product_name, size, quantity, price, source, source_name, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($order['items'] as $item) {
            $itemStmt->execute([
                $order['id'],
                $line++,
                $item['productCode'],
                $item['productName'],
                $item['size'],
                $item['qty'],
                $item['price'],
                $item['source'],
                $item['sourceName'],
                $item['imageUrl'],
            ]);
        }

        append_status_log($pdo, $order['id'], 'pending', 'system', 'Khach tao don tren landing page.');
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function upsert_customer(PDO $pdo, array $customer): int
{
    $phone = normalize_phone((string) ($customer['phone'] ?? ''));
    $stmt = $pdo->prepare('SELECT id FROM customers WHERE phone = ? LIMIT 1');
    $stmt->execute([$phone]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($existing) {
        $update = $pdo->prepare(
            'UPDATE customers SET name = COALESCE(NULLIF(?, ""), name), marketing_opt_in = ?, updated_at = NOW() WHERE id = ?'
        );
        $update->execute([(string) ($customer['name'] ?? ''), !empty($customer['marketingOptIn']) ? 1 : 0, $existing['id']]);
        return (int) $existing['id'];
    }

    $insert = $pdo->prepare(
        'INSERT INTO customers (name, phone, marketing_opt_in, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())'
    );
    $insert->execute([
        (string) ($customer['name'] ?? ''),
        $phone,
        !empty($customer['marketingOptIn']) ? 1 : 0,
    ]);
    return (int) $pdo->lastInsertId();
}

function upsert_customer_address(PDO $pdo, int $customerId, array $order): int
{
    $stmt = $pdo->prepare(
        'INSERT INTO customer_addresses (customer_id, receiver_name, phone, province, district, ward, address_detail, full_address, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())'
    );
    $stmt->execute([
        $customerId,
        $order['customerName'],
        $order['phone'],
        $order['province'],
        $order['district'],
        $order['ward'],
        $order['addressDetail'],
        $order['address'],
    ]);
    return (int) $pdo->lastInsertId();
}

function order_from_db_row(PDO $pdo, array $row): array
{
    $stmt = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no ASC');
    $stmt->execute([$row['id']]);
    $items = array_map(function ($item) {
        return [
            'productCode' => (string) $item['product_code'],
            'productName' => (string) $item['product_name'],
            'size' => (string) $item['size'],
            'qty' => (int) $item['quantity'],
            'quantity' => (int) $item['quantity'],
            'price' => (float) $item['price'],
            'source' => (string) $item['source'],
            'sourceName' => (string) $item['source_name'],
            'imageUrl' => (string) $item['image_url'],
        ];
    }, $stmt->fetchAll(PDO::FETCH_ASSOC));

    $createdAt = iso_from_mysql((string) $row['created_at']);
    $updatedAt = iso_from_mysql((string) $row['updated_at']);
    $order = [
        'id' => (string) $row['id'],
        'createdAt' => $createdAt,
        'updatedAt' => $updatedAt,
        'items' => $items,
        'total' => (float) $row['total'],
        'customerName' => (string) $row['customer_name'],
        'phone' => (string) $row['phone'],
        'address' => (string) $row['address'],
        'province' => (string) $row['province'],
        'district' => (string) $row['district'],
        'ward' => (string) $row['ward'],
        'addressDetail' => (string) $row['address_detail'],
        'note' => (string) $row['note'],
        'status' => (string) $row['status'],
        'paymentStatus' => (string) $row['payment_status'],
        'fulfillmentStatus' => (string) $row['fulfillment_status'],
        'warehouseId' => $row['warehouse_id'],
        'shippingProvider' => (string) $row['shipping_provider'],
        'trackingCode' => (string) $row['tracking_code'],
        'canCancelUntil' => iso_from_mysql((string) $row['can_cancel_until']),
        'cancelledAt' => $row['cancelled_at'] ? iso_from_mysql((string) $row['cancelled_at']) : null,
    ];
    $order['customer'] = [
        'id' => (int) $row['customer_id'],
        'name' => $order['customerName'],
        'phone' => $order['phone'],
        'address' => $order['address'],
        'province' => $order['province'],
        'district' => $order['district'],
        'ward' => $order['ward'],
        'addressDetail' => $order['addressDetail'],
    ];
    return $order;
}

function append_status_log(PDO $pdo, string $orderId, string $status, string $actor, string $note): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO order_status_logs (order_id, status, actor_type, note, created_at) VALUES (?, ?, ?, ?, NOW())'
    );
    $stmt->execute([$orderId, $status, $actor, $note]);
}

function db(): ?PDO
{
    static $pdo = false;
    if ($pdo !== false) {
        return $pdo;
    }

    $host = trim((string) getenv('DB_HOST'));
    $name = trim((string) getenv('DB_NAME'));
    $user = trim((string) getenv('DB_USER'));
    $pass = (string) getenv('DB_PASSWORD');
    if ($host === '' || $name === '' || $user === '') {
        $pdo = null;
        return null;
    }

    try {
        $pdo = new PDO(
            'mysql:host=' . $host . ';dbname=' . $name . ';charset=utf8mb4',
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
        return $pdo;
    } catch (Throwable $error) {
        error_log('TopRun DB connection failed: ' . $error->getMessage());
        $pdo = null;
        return null;
    }
}

function storage_mode(): string
{
    return db() ? 'mysql' : 'json';
}

function send_order_to_telegram(array $order): array
{
    $token = trim((string) getenv('TELEGRAM_BOT_TOKEN'));
    $chatId = trim((string) getenv('TELEGRAM_CHAT_ID'));
    if ($chatId === '') {
        $chatId = trim((string) getenv('TELEGRAM_ALERT_CHAT_ID'));
    }

    if ($token === '' || $chatId === '') {
        return [
            'ok' => false,
            'skipped' => true,
            'reason' => 'Telegram bot is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID or TELEGRAM_ALERT_CHAT_ID.'
        ];
    }

    return post_json('https://api.telegram.org/bot' . $token . '/sendMessage', [
        'chat_id' => $chatId,
        'text' => telegram_order_message($order),
        'protect_content' => true,
    ], 'Telegram notification failed');
}

function append_order_to_google_sheet(array $order): array
{
    $webhook = trim((string) getenv('GOOGLE_SHEET_WEBHOOK_URL'));
    if ($webhook === '') {
        return ['ok' => false, 'skipped' => true, 'reason' => 'GOOGLE_SHEET_WEBHOOK_URL is not configured'];
    }

    return post_json($webhook, [
        'secret' => trim((string) getenv('GOOGLE_SHEET_SECRET')),
        'order' => $order,
    ], 'Google Sheet webhook failed');
}

function post_json(string $url, array $payload, string $fallbackReason): array
{
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $responseBody = '';
    $status = 0;

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        $responseBody = (string) curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if ($responseBody === '' && $error !== '') {
            return ['ok' => false, 'reason' => $error];
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $body,
                'timeout' => 10,
            ],
        ]);
        $responseBody = (string) @file_get_contents($url, false, $context);
        $status = response_status_from_headers($http_response_header ?? []);
    }

    $decoded = json_decode($responseBody, true);
    if ($status < 200 || $status >= 300 || (is_array($decoded) && ($decoded['ok'] ?? true) === false)) {
        return [
            'ok' => false,
            'status' => $status,
            'reason' => is_array($decoded)
                ? (string) ($decoded['description'] ?? $decoded['error'] ?? $fallbackReason)
                : ($responseBody !== '' ? substr($responseBody, 0, 500) : $fallbackReason),
        ];
    }

    return ['ok' => true, 'status' => $status];
}

function telegram_order_message(array $order): string
{
    $lines = [];
    foreach (($order['items'] ?? []) as $index => $item) {
        $lines[] = ($index + 1) . '. ' . ($item['productCode'] ?? '') . ' - ' . ($item['productName'] ?? '')
            . "\nSize: " . ($item['size'] ?? '')
            . ' | SL: ' . ($item['qty'] ?? $item['quantity'] ?? 1)
            . ' | Gia: ' . format_vnd($item['price'] ?? 0);
    }

    return implode("\n", [
        'DON MOI ' . ($order['id'] ?? ''),
        'Thoi gian: ' . ($order['createdAt'] ?? ''),
        '',
        'Khach: ' . (($order['customerName'] ?? '') !== '' ? $order['customerName'] : '-'),
        'SDT: ' . (($order['phone'] ?? '') !== '' ? $order['phone'] : '-'),
        'Tinh/TP: ' . (($order['province'] ?? '') !== '' ? $order['province'] : '-'),
        'Huyen/Quan: ' . (($order['district'] ?? '') !== '' ? $order['district'] : '-'),
        'Xa/Phuong: ' . (($order['ward'] ?? '') !== '' ? $order['ward'] : '-'),
        'Dia chi: ' . (($order['address'] ?? '') !== '' ? $order['address'] : '-'),
        'Ghi chu: ' . (($order['note'] ?? '') !== '' ? $order['note'] : '-'),
        '',
        count($lines) ? implode("\n\n", $lines) : 'Khong co san pham',
        '',
        'Tong: ' . format_vnd($order['total'] ?? 0),
        'Huy don truoc: ' . (($order['canCancelUntil'] ?? '') !== '' ? $order['canCancelUntil'] : '-'),
    ]);
}

function require_orders_token(): void
{
    $token = trim((string) getenv('LANDING_ORDERS_TOKEN'));
    if ($token === '' || !hash_equals($token, supplied_orders_token())) {
        json_response([
            'ok' => false,
            'error' => 'orders_token_required',
            'message' => 'Can LANDING_ORDERS_TOKEN de doc don hang.'
        ], 401);
    }
}

function supplied_orders_token(): string
{
    $authorization = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    $bearer = preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches) ? trim($matches[1]) : '';
    if ($bearer !== '') {
        return $bearer;
    }
    if (!empty($_SERVER['HTTP_X_TOPRUN_ORDERS_TOKEN'])) {
        return trim((string) $_SERVER['HTTP_X_TOPRUN_ORDERS_TOKEN']);
    }
    return trim((string) ($_GET['token'] ?? ''));
}

function make_order_id(): string
{
    return 'ORD-' . gmdate('Ymd-His') . '-' . substr(bin2hex(random_bytes(3)), 0, 6);
}

function full_address(string $detail, string $ward, string $district, string $province): string
{
    return implode(', ', array_values(array_filter([$detail, $ward, $district, $province], function ($part) {
        return trim((string) $part) !== '';
    })));
}

function normalize_phone(string $phone): string
{
    return preg_replace('/[^\d+]/', '', trim($phone)) ?? '';
}

function mysql_datetime(string $iso): string
{
    $time = strtotime($iso);
    if ($time === false) {
        $time = time();
    }
    return gmdate('Y-m-d H:i:s', $time);
}

function iso_from_mysql(string $value): string
{
    $time = strtotime($value . ' UTC');
    if ($time === false) {
        return $value;
    }
    return gmdate('c', $time);
}

function load_env(string $path): void
{
    if (!is_file($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || starts_with($line, '#')) {
            continue;
        }
        $separator = strpos($line, '=');
        if ($separator === false || $separator <= 0) {
            continue;
        }
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

function read_request_json(): array
{
    $raw = (string) file_get_contents('php://input');
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function read_json_file(string $path, array $fallback): array
{
    if (!is_file($path)) {
        return $fallback;
    }
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? $decoded : $fallback;
}

function ensure_data_dir(string $path): void
{
    if (!is_dir($path)) {
        mkdir($path, 0755, true);
    }
}

function number_value($value, float $fallback): float
{
    if (is_numeric($value)) {
        return (float) $value;
    }
    return $fallback;
}

function format_vnd($value): string
{
    return number_format(number_value($value, 0), 0, ',', '.') . ' VND';
}

function response_status_from_headers(array $headers): int
{
    foreach ($headers as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', (string) $header, $matches)) {
            return (int) $matches[1];
        }
    }
    return 0;
}

function starts_with(string $value, string $needle): bool
{
    return $needle === '' || strpos($value, $needle) === 0;
}

function ends_with(string $value, string $needle): bool
{
    if ($needle === '') {
        return true;
    }
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

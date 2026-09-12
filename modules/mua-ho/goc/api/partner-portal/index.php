<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime(['login']);

$root = dirname(__DIR__, 2);
load_env($root . '/api/.env');
load_env($root . '/.env');

$dataPath = $root . '/data/partner-portal.json';
$syncEventsPath = $root . '/data/sync-events.json';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));

if ($method === 'GET' && $action === '') {
    json_response(partner_portal_state($dataPath, trim((string) ($_GET['token'] ?? ''))));
}

if ($method === 'GET' && $action === 'admin-preview') {
    require_admin_token();
    json_response(partner_portal_admin_preview($dataPath, trim((string) ($_GET['partnerId'] ?? ''))));
}

if ($method === 'GET' && $action === 'admin-snapshot') {
    require_admin_token();
    json_response(partner_portal_admin_snapshot($dataPath));
}

if ($method === 'POST' && $action === 'sync') {
    require_admin_token();
    json_response(sync_partner_portal_data($dataPath, read_request_json()));
}

if ($method === 'POST' && $action === 'login') {
    json_response(login_partner_portal($dataPath, read_request_json()));
}

if ($method === 'POST' && $action === 'purchases') {
    json_response(confirm_partner_purchase($dataPath, $syncEventsPath, read_request_json()));
}

if ($method === 'POST' && $action === 'order-packing') {
    json_response(update_partner_order_packing($dataPath, read_request_json()));
}

json_response(['ok' => false, 'error' => 'method_not_allowed', 'message' => 'Method not allowed.'], 405);

function sync_partner_portal_data(string $path, array $body): array
{
    $current = read_portal_data($path);
    $syncMode = strtolower(trim((string) ($body['syncMode'] ?? 'delta'))) === 'full' ? 'full' : 'delta';
    $currentEntityCount = count(portal_array($current['procurementPartners'] ?? []))
        + count(portal_array($current['orders'] ?? []))
        + count(portal_array($current['procurementPurchases'] ?? []))
        + count(portal_array($current['partnerFeePayments'] ?? []));
    if ($syncMode === 'delta' && $currentEntityCount === 0) {
        json_response(['ok' => false, 'error' => 'portal_baseline_required', 'message' => 'Portal chua co baseline; tu choi ghi delta de tranh tao snapshot thieu.'], 409);
    }
    $partners = $syncMode === 'full'
        ? merge_portal_array([], $body['procurementPartners'] ?? [])
        : merge_portal_array($current['procurementPartners'] ?? [], $body['procurementPartners'] ?? []);
    $snapshot = [
        'version' => 1,
        'procurementPartners' => sanitize_portal_partners($partners),
        'orders' => $syncMode === 'full'
            ? merge_portal_array([], $body['orders'] ?? [])
            : merge_portal_array($current['orders'] ?? [], $body['orders'] ?? []),
        'procurementPurchases' => merge_portal_array($current['procurementPurchases'] ?? [], $body['procurementPurchases'] ?? [], 'procurementPurchases'),
        'partnerFeePayments' => $syncMode === 'full'
            ? merge_portal_array([], $body['partnerFeePayments'] ?? [])
            : merge_portal_array($current['partnerFeePayments'] ?? [], $body['partnerFeePayments'] ?? []),
        'partnerFeeAdjustments' => isset($body['partnerFeeAdjustments']) && $syncMode === 'full'
            ? merge_portal_array([], $body['partnerFeeAdjustments'] ?? [])
            : merge_portal_array($current['partnerFeeAdjustments'] ?? [], $body['partnerFeeAdjustments'] ?? []),
        'syncedAt' => gmdate('c'),
    ];
    write_portal_data($path, $snapshot);
    return [
        'ok' => true,
        'data' => [
            'partners' => count($snapshot['procurementPartners']),
            'orders' => count($snapshot['orders']),
            'purchases' => count($snapshot['procurementPurchases']),
            'syncedAt' => $snapshot['syncedAt'],
        ],
        'message' => 'Da dong bo du lieu portal doi tac len landing.',
    ];
}

function partner_portal_state(string $path, string $token): array
{
    $data = read_portal_data($path);
    $partner = find_partner_by_token($data, $token);
    if (!$token || !$partner) {
        json_response(['ok' => false, 'error' => 'portal_forbidden', 'message' => 'Link doi tac khong hop le hoac da bi khoa.'], 403);
    }
    return partner_state_for_data($data, $partner);
}

function login_partner_portal(string $path, array $body): array
{
    $login = strtolower(trim((string) ($body['login'] ?? $body['username'] ?? '')));
    $password = trim((string) ($body['password'] ?? ''));
    if ($login === '' || $password === '') {
        json_response(['ok' => false, 'error' => 'missing_login', 'message' => 'Vui long nhap ID dang nhap va mat khau.'], 422);
    }
    $data = read_portal_data($path);
    $partner = null;
    foreach (portal_array($data['procurementPartners'] ?? []) as $item) {
        $itemLogin = strtolower(trim((string) ($item['login'] ?? $item['id'] ?? '')));
        if ($itemLogin === $login && ($item['status'] ?? 'active') !== 'inactive') {
            $partner = $item;
            break;
        }
    }
    if (!$partner || !partner_password_matches($partner, $password)) {
        json_response(['ok' => false, 'error' => 'invalid_login', 'message' => 'ID dang nhap hoac mat khau khong dung.'], 401);
    }
    return partner_state_for_data($data, $partner);
}

function sanitize_portal_partners(array $partners): array
{
    return array_map(function ($partner) {
        if (is_array($partner)) {
            unset($partner['password'], $partner['_temporaryPassword']);
        }
        return $partner;
    }, portal_array($partners));
}

function partner_password_matches(array $partner, string $password): bool
{
    $hash = trim((string) ($partner['passwordHash'] ?? ''));
    if ($hash !== '') return verify_partner_password($password, $hash);
    $legacy = trim((string) ($partner['password'] ?? ''));
    return $legacy !== '' && hash_equals($legacy, $password);
}

function verify_partner_password(string $password, string $storedHash): bool
{
    $parts = explode('$', $storedHash);
    if (count($parts) !== 4) return false;
    [$method, $iterationText, $salt, $hash] = $parts;
    $iterations = (int) $iterationText;
    if ($method !== 'pbkdf2' || $iterations <= 0 || $salt === '' || $hash === '') return false;
    $expected = base64url_decode_text($hash);
    if (!is_string($expected)) return false;
    foreach (partner_salt_variants($salt) as $saltValue) {
        $derived = pbkdf2_sha256_binary($password, $saltValue, $iterations, strlen($expected));
        if (strlen($expected) === strlen($derived) && hash_equals($expected, $derived)) {
            return true;
        }
    }
    return false;
}

function partner_salt_variants(string $salt): array
{
    $variants = [$salt];
    $decodedSalt = base64url_decode_text($salt);
    if (is_string($decodedSalt)) $variants[] = $decodedSalt;
    return array_values(array_unique($variants));
}

function pbkdf2_sha256_binary(string $password, string $salt, int $iterations, int $length): string
{
    if ($iterations <= 0 || $length <= 0) return '';
    $hashLength = 32;
    $blockCount = (int) ceil($length / $hashLength);
    $output = '';
    for ($block = 1; $block <= $blockCount; $block++) {
        $last = $salt . pack('N', $block);
        $last = hash_hmac('sha256', $last, $password, true);
        $xor = $last;
        for ($i = 1; $i < $iterations; $i++) {
            $last = hash_hmac('sha256', $last, $password, true);
            $xor = $xor ^ $last;
        }
        $output .= $xor;
    }
    return substr($output, 0, $length);
}

function base64url_decode_text(string $value)
{
    $base64 = strtr($value, '-_', '+/');
    $padding = strlen($base64) % 4;
    if ($padding) $base64 .= str_repeat('=', 4 - $padding);
    return base64_decode($base64, true);
}

function confirm_partner_purchase(string $path, string $syncEventsPath, array $body): array
{
    $data = read_portal_data($path);
    $partner = find_partner_by_token($data, trim((string) ($body['token'] ?? '')));
    if (!$partner) {
        json_response(['ok' => false, 'error' => 'portal_forbidden', 'message' => 'Link doi tac khong hop le hoac da bi khoa.'], 403);
    }
    $commandId = trim((string) ($body['commandId'] ?? ''));
    if ($commandId !== '') {
        foreach (portal_array($data['procurementPurchases'] ?? []) as $previousSession) {
            if (in_array($commandId, portal_array($previousSession['commandIds'] ?? []), true)) {
                return [
                    'ok' => true,
                    'session' => $previousSession,
                    'needs' => partner_purchase_needs($data, (string) ($partner['id'] ?? '')),
                    'orders' => partner_order_refs($data, (string) ($partner['id'] ?? '')),
                    'payments' => partner_payments($data, (string) ($partner['id'] ?? '')),
                    'summary' => partner_summary($data, (string) ($partner['id'] ?? '')),
                    'duplicate' => true,
                    'message' => 'Thao tac nay da duoc ghi nhan truoc do.',
                ];
            }
        }
    }
    $productCode = trim((string) ($body['productCode'] ?? ''));
    $size = trim((string) ($body['size'] ?? ''));
    $quantity = max(0, (int) number_value($body['quantity'] ?? 0, 0));
    $actualUnitCost = max(0, number_value($body['actualUnitCost'] ?? $body['unitCost'] ?? 0, 0));
    if ($productCode === '') {
        json_response(['ok' => false, 'error' => 'missing_fields', 'message' => 'Can co ma san pham.'], 422);
    }
    $allocation = allocate_partner_purchase($data, [
        'partnerId' => (string) ($partner['id'] ?? ''),
        'productCode' => $productCode,
        'size' => $size,
        'quantity' => $quantity,
        'actualCostPrice' => $actualUnitCost,
    ]);
    $fee = partner_purchase_fee($partner, $quantity, $allocation['allocations']);
    $session = [
        'id' => 'buy_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 8),
        'partnerId' => (string) ($partner['id'] ?? ''),
        'productCode' => $productCode,
        'size' => $size,
        'quantity' => $quantity,
        'lines' => $allocation['lines'],
        'note' => trim((string) ($body['note'] ?? '')),
        'allocations' => $allocation['allocations'],
        'unallocatedQty' => $allocation['unallocatedQty'],
        'productFee' => $fee['productFee'],
        'orderFee' => $fee['orderFee'],
        'orderCount' => $fee['orderCount'],
        'feeAmount' => $fee['total'],
        'status' => $allocation['unallocatedQty'] > 0 ? 'partial_allocated' : 'allocated',
        'source' => 'toprun.site_partner_portal',
        'revision' => 1,
        'commandIds' => $commandId !== '' ? [$commandId] : [],
        'history' => [[
            'at' => gmdate('c'),
            'action' => $quantity === 0 ? 'partner_out_of_stock' : 'partner_confirmed',
            'quantity' => $quantity,
            'actor' => (string) ($partner['name'] ?? $partner['id'] ?? ''),
        ]],
        'createdAt' => gmdate('c'),
        'updatedAt' => gmdate('c'),
    ];
    if ($actualUnitCost > 0) {
        $session['actualCostPrice'] = $actualUnitCost;
    }
    $data['procurementPurchases'] = portal_array($data['procurementPurchases'] ?? []);
    array_unshift($data['procurementPurchases'], $session);
    refresh_order_procurement_statuses($data);
    $data['updatedAt'] = gmdate('c');
    write_portal_data($path, $data);
    $syncEvent = append_sync_event($syncEventsPath, 'partner_purchase.created', [
        'session' => $session,
        'orderIds' => array_values(array_unique(array_filter(array_map(function ($item) {
            return is_array($item) ? (string) ($item['orderId'] ?? '') : '';
        }, portal_array($session['allocations'] ?? []))))),
        'partnerId' => (string) ($partner['id'] ?? ''),
        'productCode' => $productCode,
        'size' => $size,
        'quantity' => $quantity,
    ], [
        'entityType' => 'procurementPurchase',
        'entityId' => (string) ($session['id'] ?? ''),
        'source' => 'partner_portal',
    ]);
    return [
        'ok' => true,
        'session' => $session,
        'syncEvent' => $syncEvent,
        'needs' => partner_purchase_needs($data, (string) ($partner['id'] ?? '')),
        'orders' => partner_order_refs($data, (string) ($partner['id'] ?? '')),
        'payments' => partner_payments($data, (string) ($partner['id'] ?? '')),
        'summary' => partner_summary($data, (string) ($partner['id'] ?? '')),
        'message' => $quantity === 0
            ? 'Da ghi nhan kho nay het hang. Sales Desk se chuyen dong sang kho con hang tiep theo.'
            : 'Da ghi nhan so luong thuc te mua duoc.',
    ];
}

function partner_portal_admin_preview(string $path, string $partnerId): array
{
    $data = read_portal_data($path);
    foreach (portal_array($data['procurementPartners'] ?? []) as $partner) {
        if ((string) ($partner['id'] ?? '') !== $partnerId || ($partner['status'] ?? 'active') === 'inactive') continue;
        return partner_state_for_data($data, $partner);
    }
    return ['ok' => false, 'error' => 'partner_not_found', 'message' => 'Khong tim thay doi tac de xem portal.'];
}

function partner_portal_admin_snapshot(string $path): array
{
    $data = read_portal_data($path);
    return [
        'ok' => true,
        'procurementPurchases' => portal_array($data['procurementPurchases'] ?? []),
        'syncedAt' => (string) ($data['syncedAt'] ?? ''),
        'generatedAt' => gmdate('c'),
    ];
}

function update_partner_order_packing(string $path, array $body): array
{
    $data = read_portal_data($path);
    $partner = find_partner_by_token($data, trim((string) ($body['token'] ?? '')));
    if (!$partner) {
        json_response(['ok' => false, 'error' => 'portal_forbidden', 'message' => 'Link doi tac khong hop le hoac da bi khoa.'], 403);
    }
    $orderId = trim((string) ($body['orderId'] ?? ''));
    $nextStatus = trim((string) ($body['status'] ?? '')) === 'packed' ? 'packed' : 'pending';
    foreach ($data['orders'] as &$order) {
        if ((string) ($order['id'] ?? '') !== $orderId || !order_has_partner($order, (string) ($partner['id'] ?? ''))) {
            continue;
        }
        if (!isset($order['partnerPackingStatuses']) || !is_array($order['partnerPackingStatuses'])) {
            $order['partnerPackingStatuses'] = [];
        }
        $order['partnerPackingStatuses'][(string) ($partner['id'] ?? '')] = [
            'status' => $nextStatus,
            'updatedAt' => gmdate('c'),
            'updatedBy' => (string) ($partner['name'] ?? $partner['id'] ?? ''),
            'source' => 'partner_portal',
        ];
        $order['updatedAt'] = gmdate('c');
        write_portal_data($path, $data);
        return [
            'ok' => true,
            'orders' => partner_order_refs($data, (string) ($partner['id'] ?? '')),
            'message' => $nextStatus === 'packed' ? 'Da cap nhat don da dong hang.' : 'Da chuyen ve chua dong hang.',
        ];
    }
    json_response(['ok' => false, 'error' => 'order_not_found', 'message' => 'Khong tim thay don hang.'], 404);
}

function partner_state_for_data(array $data, array $partner): array
{
    $partnerId = (string) ($partner['id'] ?? '');
    return [
        'ok' => true,
        'partner' => public_partner($partner),
        'token' => (string) ($partner['portalToken'] ?? ''),
        'needs' => partner_purchase_needs($data, $partnerId),
        'orders' => partner_order_refs($data, $partnerId),
        'purchases' => array_slice(normalized_partner_purchases($data, $partnerId), 0, 50),
        'payments' => partner_payments($data, $partnerId),
        'adjustments' => partner_fee_adjustments($data, $partnerId),
        'summary' => partner_summary($data, $partnerId),
        'syncedAt' => (string) ($data['syncedAt'] ?? ''),
        'generatedAt' => gmdate('c'),
    ];
}

function public_partner(array $partner): array
{
    return [
        'id' => (string) ($partner['id'] ?? ''),
        'name' => (string) ($partner['name'] ?? ''),
        'login' => (string) ($partner['login'] ?? ''),
        'productFee' => number_value($partner['productFee'] ?? 0, 0),
        'orderFee' => number_value($partner['orderFee'] ?? 0, 0),
        'feeMode' => (string) ($partner['feeMode'] ?? 'both'),
    ];
}

function partner_portal_order_needs_purchase(array $order): bool
{
    if (!empty($order['deletedAt'])) return false;
    $inactiveStatuses = ['ready_to_ship', 'sent_to_sapo', 'shipping', 'shipped', 'delivered', 'fulfilled', 'completed', 'cancelled', 'partner_out_of_stock', 'soft_deleted'];
    $status = strtolower(trim((string) ($order['status'] ?? '')));
    if (in_array($status, $inactiveStatuses, true)) return false;
    $inactiveFlowStatuses = ['ready_to_ship', 'shipped', 'shipping', 'delivered', 'fulfilled', 'completed', 'cancelled'];
    $flowValues = [
        $order['fulfillmentStatus'] ?? '',
        $order['shippingStatus'] ?? '',
        $order['deliveryStatus'] ?? '',
        $order['logisticsStatus'] ?? '',
        $order['carrierStatus'] ?? '',
    ];
    foreach ($flowValues as $value) {
        if (in_array(strtolower(trim((string) $value)), $inactiveFlowStatuses, true)) return false;
    }
    if (trim((string) ($order['trackingCode'] ?? '')) !== '' && in_array($status, ['ready_to_ship', 'sent_to_sapo', 'partner_confirmed'], true)) return false;
    return true;
}

function portal_order_line_eligible_for_purchase(array $data, array $order, array $item, int $lineIndex): bool
{
    if (!partner_portal_order_needs_purchase($order)) return false;
    $status = strtolower(trim((string) ($item['procurementStatus'] ?? '')));
    if (in_array($status, ['purchase_blocked', 'partner_out_of_stock'], true)) return false;
    $paid = number_value($order['paidAmount'] ?? $order['paymentReceivedAmount'] ?? 0, 0) > 0
        || in_array(strtolower(trim((string) ($order['paymentStatus'] ?? ''))), ['paid', 'partially_paid', 'payment_confirmed', 'deposit_received'], true);
    $authorized = !empty($item['purchaseAuthorized']) || $status === 'purchase_ready';
    if (!$paid && !$authorized) return false;
    $needed = max(1, (int) number_value($item['quantity'] ?? $item['qty'] ?? 1, 1));
    return purchased_qty_for_line($data, (string) ($order['id'] ?? ''), $lineIndex, '') < $needed;
}

function partner_purchase_unit_cost(array $item): float
{
    return max(0, number_value($item['saleFilePrice'] ?? 0, 0));
}

function partner_purchase_line_from_item(array $item, int $quantity): array
{
    $unitCost = partner_purchase_unit_cost($item);
    $actualCostPrice = max(0, number_value($item['actualCostPrice'] ?? 0, 0));
    $effectiveCost = $actualCostPrice > 0 ? $actualCostPrice : $unitCost;
    $qty = max(0, $quantity);
    return [
        'productCode' => (string) ($item['productCode'] ?? $item['sku'] ?? ''),
        'productName' => (string) ($item['productName'] ?? $item['name'] ?? $item['productCode'] ?? $item['sku'] ?? ''),
        'size' => (string) ($item['size'] ?? ''),
        'quantity' => $qty,
        'unitCost' => $unitCost,
        'actualCostPrice' => $effectiveCost,
        'lineTotal' => $effectiveCost * $qty,
    ];
}

function partner_order_item_for_allocation(array $data, array $allocation, array $session): array
{
    $orderId = trim((string) ($allocation['orderId'] ?? ''));
    $lineIndex = (int) number_value($allocation['lineIndex'] ?? 0, 0);
    foreach (portal_array($data['orders'] ?? []) as $order) {
        if (!is_array($order) || trim((string) ($order['id'] ?? '')) !== $orderId) continue;
        $items = portal_order_items($order);
        if (isset($items[$lineIndex]) && is_array($items[$lineIndex])) return $items[$lineIndex];
    }
    return [
        'productCode' => (string) ($allocation['productCode'] ?? $session['productCode'] ?? ''),
        'productName' => (string) ($allocation['productName'] ?? $session['productName'] ?? ''),
        'size' => (string) ($allocation['size'] ?? $session['size'] ?? ''),
        'quantity' => number_value($allocation['quantity'] ?? $session['quantity'] ?? 0, 0),
        'unitCost' => number_value($allocation['unitCost'] ?? $session['unitCost'] ?? 0, 0),
        'saleFilePrice' => number_value($allocation['saleFilePrice'] ?? $session['saleFilePrice'] ?? 0, 0),
        'originalSalePrice' => number_value($allocation['originalSalePrice'] ?? $session['originalSalePrice'] ?? 0, 0),
        'preMarkupSalePrice' => number_value($allocation['preMarkupSalePrice'] ?? $session['preMarkupSalePrice'] ?? 0, 0),
    ];
}

function normalize_partner_purchase_session(array $data, array $session): array
{
    $allocations = portal_array($session['allocations'] ?? []);
    $lines = [];
    if (!empty($allocations)) {
        foreach ($allocations as $allocation) {
            if (!is_array($allocation)) continue;
            $sourceItem = partner_order_item_for_allocation($data, $allocation, $session);
            $quantity = (int) number_value($allocation['quantity'] ?? 0, 0);
            $line = partner_purchase_line_from_item(array_merge($sourceItem, $allocation), $quantity);
            $line['orderId'] = (string) ($allocation['orderId'] ?? '');
            $line['lineIndex'] = (int) number_value($allocation['lineIndex'] ?? 0, 0);
            $lines[] = $line;
        }
    } elseif (!empty($session['lines']) && is_array($session['lines'])) {
        foreach (portal_array($session['lines']) as $line) {
            if (!is_array($line)) continue;
            $quantity = (int) number_value($line['quantity'] ?? 0, 0);
            $unitCost = partner_purchase_unit_cost($line);
            $actualCostPrice = max(0, number_value($line['actualCostPrice'] ?? 0, 0));
            $line['quantity'] = $quantity;
            $line['unitCost'] = $unitCost;
            $line['actualCostPrice'] = $actualCostPrice;
            $line['lineTotal'] = ($actualCostPrice > 0 ? $actualCostPrice : $unitCost) * $quantity;
            $lines[] = $line;
        }
    } else {
        $lines[] = partner_purchase_line_from_item($session, (int) number_value($session['quantity'] ?? 0, 0));
    }
    $unitCost = number_value($session['unitCost'] ?? 0, 0);
    if ($unitCost <= 0) {
        foreach ($lines as $line) {
            $lineUnitCost = number_value($line['unitCost'] ?? 0, 0);
            if ($lineUnitCost > 0) {
                $unitCost = $lineUnitCost;
                break;
            }
        }
    }
    $purchaseTotal = array_sum(array_map(function ($line) {
        return number_value($line['lineTotal'] ?? 0, 0);
    }, $lines));
    foreach ($allocations as $index => &$allocation) {
        if (!is_array($allocation)) continue;
        $allocation['unitCost'] = number_value($allocation['unitCost'] ?? 0, 0) ?: number_value($lines[$index]['unitCost'] ?? 0, 0);
        $allocation['actualCostPrice'] = number_value($allocation['actualCostPrice'] ?? 0, 0) ?: number_value($lines[$index]['actualCostPrice'] ?? 0, 0);
        $allocation['lineTotal'] = number_value($lines[$index]['lineTotal'] ?? 0, 0);
    }
    unset($allocation);
    $session['unitCost'] = $unitCost;
    $session['purchaseTotal'] = $purchaseTotal;
    $session['lines'] = $lines;
    $session['allocations'] = $allocations;
    return $session;
}

function normalized_partner_purchases(array $data, string $partnerId = ''): array
{
    $rows = [];
    foreach (portal_array($data['procurementPurchases'] ?? []) as $session) {
        if (!is_array($session)) continue;
        if ($partnerId !== '' && (string) ($session['partnerId'] ?? '') !== $partnerId) continue;
        $rows[] = normalize_partner_purchase_session($data, $session);
    }
    return $rows;
}

function partner_purchase_needs(array $data, string $partnerId): array
{
    $rows = [];
    $orders = portal_array($data['orders'] ?? []);
    usort($orders, function ($a, $b) {
        return strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? ''));
    });
    foreach ($orders as $order) {
        if (!partner_portal_order_needs_purchase($order)) {
            continue;
        }
        foreach (portal_order_items($order) as $lineIndex => $item) {
            if (!portal_order_line_eligible_for_purchase($data, $order, $item, (int) $lineIndex)) continue;
            if (!in_array($partnerId, portal_partner_ids($item['partnerIds'] ?? $item['partnerId'] ?? ''), true)) continue;
            $productCode = trim((string) ($item['productCode'] ?? $item['sku'] ?? ''));
            $size = trim((string) ($item['size'] ?? ''));
            if ($productCode === '') continue;
            $key = strtolower($partnerId . '|' . $productCode . '|' . $size);
            if (!isset($rows[$key])) {
                $rows[$key] = [
                    'partnerId' => $partnerId,
                    'productCode' => $productCode,
                    'productName' => (string) ($item['productName'] ?? $productCode),
                    'size' => $size,
                    'unitCost' => partner_purchase_unit_cost($item),
                    'requiredQty' => 0,
                    'purchasedQty' => 0,
                    'missingQty' => 0,
                    'newQty' => 0,
                    'backlogQty' => 0,
                    'orders' => [],
                ];
            }
            $quantity = max(1, (int) number_value($item['quantity'] ?? $item['qty'] ?? 1, 1));
            $purchased = purchased_qty_for_line($data, (string) ($order['id'] ?? ''), (int) $lineIndex, $partnerId);
            $unitCost = partner_purchase_unit_cost($item);
            if (empty($rows[$key]['unitCost']) && $unitCost > 0) $rows[$key]['unitCost'] = $unitCost;
            $rows[$key]['requiredQty'] += $quantity;
            $rows[$key]['orders'][] = [
                'orderId' => (string) ($order['id'] ?? ''),
                'lineIndex' => $lineIndex,
                'quantity' => $quantity,
                'unitCost' => $unitCost,
                'purchasedQty' => $purchased,
                'remainingQty' => max(0, $quantity - $purchased),
                'createdAt' => (string) ($order['createdAt'] ?? ''),
            ];
        }
    }
    foreach ($rows as &$row) {
        $row['purchasedQty'] = array_sum(array_map(function ($item) {
            return (int) ($item['purchasedQty'] ?? 0);
        }, $row['orders']));
        $row['newQty'] = array_sum(array_map(function ($item) {
            return (int) ($item['purchasedQty'] ?? 0) > 0 ? 0 : (int) ($item['remainingQty'] ?? 0);
        }, $row['orders']));
        $row['backlogQty'] = array_sum(array_map(function ($item) {
            return (int) ($item['purchasedQty'] ?? 0) > 0 ? (int) ($item['remainingQty'] ?? 0) : 0;
        }, $row['orders']));
        $row['missingQty'] = (int) $row['newQty'] + (int) $row['backlogQty'];
        $row['orders'] = array_values(array_filter($row['orders'], function ($item) {
            return (int) ($item['remainingQty'] ?? 0) > 0;
        }));
        $row['latestOrderAt'] = '';
        foreach ($row['orders'] as $item) {
            $createdAt = (string) ($item['createdAt'] ?? '');
            if ($createdAt > $row['latestOrderAt']) $row['latestOrderAt'] = $createdAt;
        }
    }
    $values = array_values(array_filter($rows, function ($item) {
        return (int) ($item['missingQty'] ?? 0) > 0;
    }));
    usort($values, function ($a, $b) {
        $dateCompare = strcmp((string) ($b['latestOrderAt'] ?? ''), (string) ($a['latestOrderAt'] ?? ''));
        if ($dateCompare !== 0) return $dateCompare;
        $codeCompare = strcmp((string) ($a['productCode'] ?? ''), (string) ($b['productCode'] ?? ''));
        if ($codeCompare !== 0) return $codeCompare;
        return strcmp((string) ($a['size'] ?? ''), (string) ($b['size'] ?? ''));
    });
    return $values;
}

function partner_order_refs(array $data, string $partnerId): array
{
    $rows = [];
    $orders = portal_array($data['orders'] ?? []);
    usort($orders, function ($a, $b) {
        return strcmp((string) ($b['createdAt'] ?? ''), (string) ($a['createdAt'] ?? ''));
    });
    foreach ($orders as $order) {
        if (!partner_portal_order_needs_purchase($order)) {
            continue;
        }
        foreach (portal_order_items($order) as $lineIndex => $item) {
            if (!portal_order_line_eligible_for_purchase($data, $order, $item, (int) $lineIndex)) continue;
            if (!in_array($partnerId, portal_partner_ids($item['partnerIds'] ?? $item['partnerId'] ?? ''), true)) continue;
            $quantity = max(1, (int) number_value($item['quantity'] ?? $item['qty'] ?? 1, 1));
            $purchased = purchased_qty_for_line($data, (string) ($order['id'] ?? ''), (int) $lineIndex, $partnerId);
            $packing = partner_order_packing_status($order, $partnerId);
            $rows[] = [
                'orderId' => (string) ($order['id'] ?? ''),
                'customerName' => (string) ($order['customerName'] ?? $order['customer'] ?? $order['name'] ?? ''),
                'createdAt' => (string) ($order['createdAt'] ?? ''),
                'productCode' => (string) ($item['productCode'] ?? $item['sku'] ?? ''),
                'productName' => (string) ($item['productName'] ?? $item['productCode'] ?? $item['sku'] ?? ''),
                'size' => (string) ($item['size'] ?? ''),
                'unitCost' => partner_purchase_unit_cost($item),
                'quantity' => $quantity,
                'purchasedQty' => $purchased,
                'missingQty' => max(0, $quantity - $purchased),
                'status' => $purchased >= $quantity ? 'done' : ($purchased > 0 ? 'partial' : 'pending'),
                'packingStatus' => $packing,
                'packingStatusLabel' => $packing === 'packed' ? 'Da dong hang' : 'Chua dong hang',
                'packingLocked' => partner_order_auto_packed($order),
            ];
        }
    }
    return $rows;
}

function partner_order_remaining_for_partner(array $data, array $order, string $partnerId, $allocationOverride = null): int
{
    $sum = 0;
    foreach (portal_order_items($order) as $lineIndex => $item) {
        if (!in_array($partnerId, portal_partner_ids($item['partnerIds'] ?? $item['partnerId'] ?? ''), true)) continue;
        $needed = max(1, (int) number_value($item['quantity'] ?? $item['qty'] ?? 1, 1));
        $purchased = purchased_qty_for_line($data, (string) ($order['id'] ?? ''), (int) $lineIndex, $partnerId);
        if ($allocationOverride && (int) ($allocationOverride['lineIndex'] ?? -1) === (int) $lineIndex) {
            $purchased += (int) ($allocationOverride['quantity'] ?? 0);
        }
        $sum += max(0, $needed - $purchased);
    }
    return $sum;
}

function allocate_partner_purchase(array &$data, array $request): array
{
    $remaining = max(0, (int) ($request['quantity'] ?? 0));
    $zeroResponse = $remaining === 0;
    $allocations = [];
    $lines = [];
    $candidates = [];
    foreach ($data['orders'] as $orderIndex => $order) {
        if (!partner_portal_order_needs_purchase($order)) continue;
        foreach (portal_order_items($order) as $lineIndex => $item) {
            if (!portal_order_line_eligible_for_purchase($data, $order, $item, (int) $lineIndex)) continue;
            $sameProduct = strtolower(trim((string) ($item['productCode'] ?? $item['sku'] ?? ''))) === strtolower((string) ($request['productCode'] ?? ''));
            $sameSize = strtolower(trim((string) ($item['size'] ?? ''))) === strtolower((string) ($request['size'] ?? ''));
            $assigned = in_array((string) ($request['partnerId'] ?? ''), portal_partner_ids($item['partnerIds'] ?? $item['partnerId'] ?? ''), true);
            if (!$sameProduct || !$sameSize || !$assigned) continue;
            $needed = max(1, (int) number_value($item['quantity'] ?? $item['qty'] ?? 1, 1));
            $already = purchased_qty_for_line($data, (string) ($order['id'] ?? ''), (int) $lineIndex, (string) ($request['partnerId'] ?? ''));
            $remainingNeed = max(0, $needed - $already);
            if ($remainingNeed <= 0) continue;
            $orderRemaining = partner_order_remaining_for_partner($data, $order, (string) ($request['partnerId'] ?? ''));
            $candidates[] = [
                'orderIndex' => $orderIndex,
                'lineIndex' => $lineIndex,
                'remainingNeed' => $remainingNeed,
                'completesOrder' => $orderRemaining === $remainingNeed && $remaining >= $remainingNeed,
                'createdAt' => (string) ($order['createdAt'] ?? ''),
            ];
        }
    }
    usort($candidates, function ($a, $b) {
        if ((bool) $a['completesOrder'] !== (bool) $b['completesOrder']) return !empty($a['completesOrder']) ? -1 : 1;
        return strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? ''));
    });
    foreach ($candidates as $candidate) {
        if ($remaining <= 0 && !$zeroResponse) break;
        $orderIndex = (int) $candidate['orderIndex'];
        $lineIndex = (int) $candidate['lineIndex'];
        if (!isset($data['orders'][$orderIndex])) continue;
        if (!isset($data['orders'][$orderIndex]['items'][$lineIndex]) || !is_array($data['orders'][$orderIndex]['items'][$lineIndex])) {
            $data['orders'][$orderIndex]['items'] = portal_order_items($data['orders'][$orderIndex]);
        }
        $allocated = $zeroResponse ? 0 : min((int) $candidate['remainingNeed'], $remaining);
        if (!$zeroResponse && $allocated <= 0) continue;
        if (!$zeroResponse) $remaining -= $allocated;
        $item = $data['orders'][$orderIndex]['items'][$lineIndex] ?? [];
        $allocations[] = [
            'orderId' => (string) ($data['orders'][$orderIndex]['id'] ?? ''),
            'lineIndex' => $lineIndex,
            'partnerId' => (string) ($request['partnerId'] ?? ''),
            'productCode' => (string) ($request['productCode'] ?? ''),
            'size' => (string) ($request['size'] ?? ''),
            'quantity' => $allocated,
            'unitCost' => partner_purchase_unit_cost($item),
            'actualCostPrice' => max(0, number_value($request['actualCostPrice'] ?? 0, 0)),
            'respondedQty' => $allocated,
            'requestedQty' => (int) $candidate['remainingNeed'],
            'responseFinal' => true,
            'responseOnly' => $allocated <= 0,
            'respondedAt' => gmdate('c'),
        ];
        if ($allocated > 0 && is_array($item)) $lines[] = partner_purchase_line_from_item(array_merge($item, ['actualCostPrice' => $request['actualCostPrice'] ?? 0]), $allocated);
        if (!isset($data['orders'][$orderIndex]['items'][$lineIndex]['procurement']) || !is_array($data['orders'][$orderIndex]['items'][$lineIndex]['procurement'])) {
            $data['orders'][$orderIndex]['items'][$lineIndex]['procurement'] = [];
        }
        $data['orders'][$orderIndex]['items'][$lineIndex]['procurement'][] = [
            'partnerId' => (string) ($request['partnerId'] ?? ''),
            'quantity' => $allocated,
            'requestedQty' => (int) $candidate['remainingNeed'],
            'responseFinal' => true,
            'at' => gmdate('c'),
        ];
        $data['orders'][$orderIndex]['updatedAt'] = gmdate('c');
    }
    return ['allocations' => $allocations, 'lines' => $lines, 'unallocatedQty' => $remaining];
}

function refresh_order_procurement_statuses(array &$data): void
{
    foreach ($data['orders'] as &$order) {
        if (!partner_portal_order_needs_purchase($order)) continue;
        $assigned = [];
        foreach (portal_order_items($order) as $index => $line) {
            $partnerIds = portal_partner_ids($line['partnerIds'] ?? $line['partnerId'] ?? '');
            if ($partnerIds) $assigned[] = ['line' => $line, 'index' => $index, 'partnerIds' => $partnerIds];
        }
        if (!$assigned) continue;
        $allDone = count($assigned) === count(portal_order_items($order));
        $anyDone = false;
        foreach ($assigned as $entry) {
            $lineDone = false;
            foreach ($entry['partnerIds'] as $partnerId) {
                $qty = max(1, (int) number_value($entry['line']['quantity'] ?? $entry['line']['qty'] ?? 1, 1));
                $purchased = purchased_qty_for_line($data, (string) ($order['id'] ?? ''), (int) $entry['index'], $partnerId);
                if ($purchased >= $qty) $lineDone = true;
                if ($purchased > 0) $anyDone = true;
            }
            if (!$lineDone) $allDone = false;
        }
        $allStockConfirmed = count($assigned) === count(portal_order_items($order));
        $purchaseAuthorized = false;
        foreach ($assigned as $entry) {
            $lineStatus = strtolower(trim((string) ($entry['line']['procurementStatus'] ?? '')));
            if (!in_array($lineStatus, ['stock_confirmed', 'confirmed_in_stock', 'available', 'purchase_ready'], true)) $allStockConfirmed = false;
            if (!empty($entry['line']['purchaseAuthorized']) || $lineStatus === 'purchase_ready') $purchaseAuthorized = true;
        }
        $paid = number_value($order['paidAmount'] ?? $order['paymentReceivedAmount'] ?? 0, 0) > 0
            || in_array(strtolower(trim((string) ($order['paymentStatus'] ?? ''))), ['paid', 'partially_paid', 'payment_confirmed', 'deposit_received'], true);
        $order['status'] = $allDone
            ? 'purchase_complete'
            : ($anyDone
                ? 'purchase_partial'
                : ($purchaseAuthorized || $paid
                    ? 'partner_assigned'
                    : ($allStockConfirmed ? 'payment_pending' : 'waiting_partner_confirm')));
    }
}

function partner_summary(array $data, string $partnerId): array
{
    $purchases = normalized_partner_purchases($data, $partnerId);
    $payments = partner_payments($data, $partnerId);
    $orderIds = [];
    foreach ($purchases as $session) {
        foreach (portal_array($session['allocations'] ?? []) as $allocation) {
            if (!empty($allocation['orderId'])) $orderIds[(string) $allocation['orderId']] = true;
        }
    }
    $feeAmount = array_sum(array_map(function ($item) {
        return number_value($item['feeAmount'] ?? 0, 0);
    }, $purchases));
    $paidAmount = array_sum(array_map(function ($item) {
        return number_value($item['amount'] ?? 0, 0);
    }, $payments));
    $adjustmentAmount = array_sum(array_map(function ($item) {
        return number_value($item['amount'] ?? 0, 0);
    }, partner_fee_adjustments($data, $partnerId)));
    $totalOwed = $feeAmount + $adjustmentAmount;
    return [
        'purchasedQty' => array_sum(array_map(function ($item) {
            return (int) number_value($item['quantity'] ?? 0, 0);
        }, $purchases)),
        'orderCount' => count($orderIds),
        'feeAmount' => $feeAmount,
        'adjustmentAmount' => $adjustmentAmount,
        'paidAmount' => $paidAmount,
        'debtAmount' => max(0, $totalOwed - $paidAmount),
        'overpaidAmount' => max(0, $paidAmount - $totalOwed),
    ];
}

function partner_payments(array $data, string $partnerId): array
{
    return array_slice(array_values(array_filter(portal_array($data['partnerFeePayments'] ?? []), function ($item) use ($partnerId) {
        return (string) ($item['partnerId'] ?? '') === $partnerId;
    })), 0, 50);
}

function partner_fee_adjustments(array $data, string $partnerId): array
{
    return array_slice(array_values(array_filter(portal_array($data['partnerFeeAdjustments'] ?? []), function ($item) use ($partnerId) {
        return (string) ($item['partnerId'] ?? '') === $partnerId;
    })), 0, 50);
}

function find_partner_by_token(array $data, string $token): ?array
{
    foreach (portal_array($data['procurementPartners'] ?? []) as $partner) {
        if ((string) ($partner['portalToken'] ?? '') === $token && ($partner['status'] ?? 'active') !== 'inactive') {
            return $partner;
        }
    }
    return null;
}

function merge_portal_array($existingValue, $incomingValue, string $collection = ''): array
{
    $merged = [];
    $indexByKey = [];
    $upsert = function ($item) use (&$merged, &$indexByKey, $collection): void {
        $key = portal_item_key($item);
        if ($key !== '' && array_key_exists($key, $indexByKey)) {
            $merged[$indexByKey[$key]] = $collection === 'procurementPurchases'
                ? merge_procurement_purchase_session($merged[$indexByKey[$key]], $item)
                : merge_portal_item($merged[$indexByKey[$key]], $item);
            return;
        }
        if ($key !== '') $indexByKey[$key] = count($merged);
        $merged[] = $item;
    };
    foreach (portal_array($existingValue) as $item) $upsert($item);
    foreach (portal_array($incomingValue) as $item) $upsert($item);
    return $merged;
}

function canonical_order_version($order): int
{
    if (!is_array($order)) return 0;
    return max(0, (int) ($order['canonicalVersion'] ?? $order['onlineOrderVersion'] ?? $order['syncVersion'] ?? 0));
}

function merge_portal_item($existing, $incoming): array
{
    $existing = is_array($existing) ? $existing : [];
    $incoming = is_array($incoming) ? $incoming : [];
    $existingVersion = canonical_order_version($existing);
    $incomingVersion = canonical_order_version($incoming);
    if ($existingVersion > 0 || $incomingVersion > 0) {
        if ($incomingVersion < $existingVersion) return $existing;
        if ($incomingVersion > $existingVersion) return array_merge($existing, $incoming);
    }
    return array_merge($existing, $incoming);
}

function procurement_nested_key($item, string $type): string
{
    if (!is_array($item)) return '';
    if (!empty($item['id'])) return 'id:' . (string) $item['id'];
    if (!empty($item['allocationId'])) return 'allocation:' . (string) $item['allocationId'];
    $parts = $type === 'history'
        ? [$item['at'] ?? $item['createdAt'] ?? '', $item['action'] ?? '', $item['orderId'] ?? '', $item['lineId'] ?? $item['lineIndex'] ?? '', $item['actor'] ?? '']
        : [$item['orderId'] ?? '', $item['lineId'] ?? $item['lineIndex'] ?? '', $item['partnerId'] ?? '', $item['productCode'] ?? $item['sku'] ?? '', $item['size'] ?? '', $type === 'lines' ? ($item['quantity'] ?? '') : ''];
    return strtolower(implode('|', array_merge([$type], array_map(function ($value) {
        return trim((string) $value);
    }, $parts))));
}

function merge_procurement_nested_array($existingValue, $incomingValue, string $type): array
{
    $output = portal_array($existingValue);
    $indexesByKey = [];
    foreach ($output as $index => $item) {
        $key = procurement_nested_key($item, $type);
        if ($key !== '') $indexesByKey[$key][] = $index;
    }
    $consumedByKey = [];
    foreach (portal_array($incomingValue) as $item) {
        $key = procurement_nested_key($item, $type);
        $consumed = (int) ($consumedByKey[$key] ?? 0);
        $matches = $indexesByKey[$key] ?? [];
        if ($key === '' || $consumed >= count($matches)) {
            $output[] = $item;
            continue;
        }
        $index = $matches[$consumed];
        $consumedByKey[$key] = $consumed + 1;
        $previous = is_array($output[$index] ?? null) ? $output[$index] : [];
        $next = array_merge($previous, is_array($item) ? $item : []);
        foreach (['undoneAt', 'undoneBy', 'undoneSource'] as $field) {
            if (!empty($previous[$field]) && empty($item[$field])) $next[$field] = $previous[$field];
        }
        $output[$index] = $next;
    }
    return $output;
}

function merge_procurement_purchase_session($existing, $incoming): array
{
    $existing = is_array($existing) ? $existing : [];
    $incoming = is_array($incoming) ? $incoming : [];
    $oldRevision = (int) ($existing['revision'] ?? 0);
    $newRevision = (int) ($incoming['revision'] ?? 0);
    $oldTime = strtotime((string) ($existing['updatedAt'] ?? $existing['createdAt'] ?? '')) ?: 0;
    $newTime = strtotime((string) ($incoming['updatedAt'] ?? $incoming['createdAt'] ?? '')) ?: 0;
    $incomingIsNewer = $newRevision > $oldRevision || ($newRevision === $oldRevision && $newTime >= $oldTime);
    $merged = $incomingIsNewer ? array_merge($existing, $incoming) : array_merge($incoming, $existing);
    $merged['lines'] = merge_procurement_nested_array($existing['lines'] ?? [], $incoming['lines'] ?? [], 'lines');
    $merged['allocations'] = merge_procurement_nested_array($existing['allocations'] ?? [], $incoming['allocations'] ?? [], 'allocations');
    $merged['history'] = merge_procurement_nested_array($existing['history'] ?? [], $incoming['history'] ?? [], 'history');
    $merged['commandIds'] = array_values(array_unique(array_merge(portal_array($existing['commandIds'] ?? []), portal_array($incoming['commandIds'] ?? []))));
    $merged['revision'] = max($oldRevision, $newRevision);
    return $merged;
}

function portal_item_key($item): string
{
    if (!is_array($item)) return '';
    if (!empty($item['id'])) return 'id:' . (string) $item['id'];
    if (!empty($item['externalSource']) && !empty($item['externalId'])) return 'external:' . (string) $item['externalSource'] . ':' . (string) $item['externalId'];
    if (!empty($item['productCode']) && isset($item['size']) && !empty($item['partnerId'])) {
        return 'need:' . (string) $item['partnerId'] . ':' . (string) $item['productCode'] . ':' . (string) $item['size'];
    }
    return '';
}

function portal_order_items(array $order): array
{
    if (!empty($order['items']) && is_array($order['items'])) return $order['items'];
    return [[
        'productCode' => (string) ($order['productCode'] ?? ''),
        'productName' => (string) ($order['productName'] ?? ''),
        'size' => (string) ($order['size'] ?? ''),
        'quantity' => $order['quantity'] ?? 1,
        'price' => $order['price'] ?? 0,
        'partnerIds' => $order['partnerIds'] ?? [],
    ]];
}

function portal_partner_ids($value): array
{
    if (is_array($value)) return array_values(array_filter(array_map(function ($item) {
        return trim((string) $item);
    }, $value)));
    return array_values(array_filter(array_map('trim', preg_split('/[,\n;]/', (string) $value) ?: [])));
}

function order_has_partner(array $order, string $partnerId): bool
{
    foreach (portal_order_items($order) as $item) {
        if (in_array($partnerId, portal_partner_ids($item['partnerIds'] ?? $item['partnerId'] ?? ''), true)) return true;
    }
    return false;
}

function partner_order_packing_status(array $order, string $partnerId): string
{
    if (partner_order_auto_packed($order)) return 'packed';
    $statuses = $order['partnerPackingStatuses'] ?? [];
    if (is_array($statuses) && (($statuses[$partnerId]['status'] ?? '') === 'packed')) return 'packed';
    return 'pending';
}

function partner_order_auto_packed(array $order): bool
{
    $values = [
        $order['shippingStatus'] ?? '',
        $order['deliveryStatus'] ?? '',
        $order['fulfillmentStatus'] ?? '',
        $order['warehouseStatus'] ?? '',
        $order['logisticsStatus'] ?? '',
        $order['carrierStatus'] ?? '',
    ];
    foreach ($values as $value) {
        $text = strtolower(trim((string) $value));
        if (contains_text($text, 'received') || contains_text($text, 'delivered') || contains_text($text, 'warehouse_received') || contains_text($text, 'in_warehouse') || contains_text($text, 'nhan_hang') || contains_text($text, 'nhap_kho')) {
            return true;
        }
    }
    return false;
}

function purchased_qty_for_line(array $data, string $orderId, int $lineIndex, string $partnerId): int
{
    $sum = 0;
    $lineId = '';
    foreach (portal_array($data['orders'] ?? []) as $order) {
        if ((string) ($order['id'] ?? '') !== $orderId) continue;
        $items = portal_order_items($order);
        $line = is_array($items[$lineIndex] ?? null) ? $items[$lineIndex] : [];
        $lineId = trim((string) ($line['lineId'] ?? $line['id'] ?? ''));
        break;
    }
    foreach (portal_array($data['procurementPurchases'] ?? []) as $session) {
        foreach (portal_array($session['allocations'] ?? []) as $allocation) {
            if ((string) ($allocation['orderId'] ?? '') === $orderId
                && (($lineId !== '' && !empty($allocation['lineId']))
                    ? (string) $allocation['lineId'] === $lineId
                    : (int) ($allocation['lineIndex'] ?? 0) === $lineIndex)
                && ($partnerId === '' || (string) ($allocation['partnerId'] ?? '') === $partnerId)
                && empty($allocation['undoneAt'])) {
                $sum += (int) number_value($allocation['quantity'] ?? 0, 0);
            }
        }
    }
    return $sum;
}

function partner_purchase_fee(array $partner, int $quantity, array $allocations): array
{
    $orderIds = [];
    foreach ($allocations as $allocation) {
        if (!empty($allocation['orderId'])) $orderIds[(string) $allocation['orderId']] = true;
    }
    $mode = (string) ($partner['feeMode'] ?? 'both');
    $productFee = in_array($mode, ['both', 'product'], true) ? number_value($partner['productFee'] ?? 0, 0) * $quantity : 0;
    $orderFee = in_array($mode, ['both', 'order'], true) ? number_value($partner['orderFee'] ?? 0, 0) * count($orderIds) : 0;
    return ['productFee' => $productFee, 'orderFee' => $orderFee, 'orderCount' => count($orderIds), 'total' => $productFee + $orderFee];
}

function read_portal_data(string $path): array
{
    $fallback = ['version' => 1, 'procurementPartners' => [], 'orders' => [], 'procurementPurchases' => [], 'partnerFeePayments' => [], 'syncedAt' => ''];
    if (!is_file($path)) return $fallback;
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? array_merge($fallback, $decoded) : $fallback;
}

function write_portal_data(string $path, array $data): void
{
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $backupPath = $dir . '/partner-portal.runtime-backup.json';
    if (is_file($path)) copy($path, $backupPath);
    $temporaryPath = $path . '.tmp';
    file_put_contents($temporaryPath, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    rename($temporaryPath, $path);
}

function read_sync_events(string $path): array
{
    $fallback = ['version' => 1, 'events' => [], 'updatedAt' => ''];
    if (!is_file($path)) return $fallback;
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? array_merge($fallback, $decoded) : $fallback;
}

function write_sync_events(string $path, array $data): void
{
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function append_sync_event(string $path, string $type, array $payload, array $options = []): array
{
    $data = read_sync_events($path);
    $createdAt = gmdate('c');
    $event = [
        'eventId' => (string) ($options['eventId'] ?? ('evt_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 8))),
        'type' => $type,
        'entityType' => (string) ($options['entityType'] ?? ''),
        'entityId' => (string) ($options['entityId'] ?? ''),
        'source' => (string) ($options['source'] ?? 'toprun.site'),
        'createdAt' => $createdAt,
        'payload' => $payload,
    ];
    $events = portal_array($data['events'] ?? []);
    $events[] = $event;
    $data['version'] = 1;
    $data['events'] = array_slice($events, -1000);
    $data['updatedAt'] = $createdAt;
    write_sync_events($path, $data);
    return $event;
}

function require_admin_token(): void
{
    $fileEnv = @parse_ini_file(dirname(__DIR__) . '/.env', false, INI_SCANNER_RAW);
    $tokens = array_values(array_filter(array_unique([
        trim((string) getenv('LANDING_ADMIN_TOKEN')),
        trim((string) getenv('LANDING_ORDERS_TOKEN')),
        trim((string) (($fileEnv['LANDING_ADMIN_TOKEN'] ?? ''))),
        trim((string) (($fileEnv['LANDING_ORDERS_TOKEN'] ?? ''))),
    ])));
    $supplied = supplied_token();
    $authorized = false;
    foreach ($tokens as $token) {
        if ($supplied !== '' && hash_equals($token, $supplied)) {
            $authorized = true;
            break;
        }
    }
    if (!$authorized) {
        json_response(['ok' => false, 'error' => 'admin_token_required', 'message' => 'Can token admin/orders de dong bo portal.'], 401);
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

function portal_array($value): array
{
    return is_array($value) ? $value : [];
}

function number_value($value, float $fallback): float
{
    return is_numeric($value) ? (float) $value : $fallback;
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

function read_request_json(): array
{
    $decoded = json_decode((string) file_get_contents('php://input'), true);
    return is_array($decoded) ? $decoded : [];
}

function contains_text(string $value, string $needle): bool
{
    return $needle === '' || strpos($value, $needle) !== false;
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

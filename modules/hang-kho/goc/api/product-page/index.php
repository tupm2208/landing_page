<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_node-single-writer.php';
enforce_php_read_only_runtime();

const SITE_ORIGIN = 'https://toprun.site';

function escape_html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function clean_text($value): string
{
    $text = trim(preg_replace('/\s+/u', ' ', strip_tags((string) $value)) ?? '');
    return $text;
}

function utf8_lower(string $value): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function utf8_length(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
}

function utf8_substring(string $value, int $start, int $length): string
{
    return function_exists('mb_substr') ? mb_substr($value, $start, $length, 'UTF-8') : substr($value, $start, $length);
}

function first_text(array $product, array $keys): string
{
    foreach ($keys as $key) {
        $value = clean_text($product[$key] ?? '');
        if ($value !== '') {
            return $value;
        }
    }
    return '';
}

function public_product_name(array $product): string
{
    $preferred = first_text($product, ['seoTitle', 'name', 'productName']);
    $brand = first_text($product, ['brand']);
    $code = first_text($product, ['code', 'productCode']);
    $parts = [];
    foreach ([$brand, $preferred, $code] as $part) {
        if ($part !== '' && !in_array(utf8_lower($part), array_map('utf8_lower', $parts), true)) {
            $parts[] = $part;
        }
    }
    return implode(' ', $parts);
}

function public_product_price(array $product): float
{
    foreach (['suggestedPrice', 'salePrice', 'price'] as $key) {
        $price = (float) ($product[$key] ?? 0);
        if ($price > 0) {
            return $price;
        }
    }
    return 0.0;
}

function absolute_public_image(string $value, string $documentRoot): string
{
    $image = trim($value);
    if ($image === '' || strpos(strtolower($image), '/assets/thumbnails/') !== false) {
        return '';
    }
    if (preg_match('#^https?://#i', $image)) {
        return $image;
    }
    $path = '/' . ltrim(str_replace('\\', '/', $image), '/');
    $localPath = $documentRoot . str_replace('/', DIRECTORY_SEPARATOR, $path);
    return is_file($localPath) ? SITE_ORIGIN . $path : '';
}

function public_product_image(array $product, string $documentRoot): string
{
    $candidates = [];
    foreach (['highImage', 'image'] as $key) {
        $candidates[] = $product[$key] ?? '';
    }
    foreach (($product['galleryImages'] ?? []) as $image) {
        $candidates[] = $image;
    }
    $candidates[] = $product['thumbnailImage'] ?? '';

    foreach ($candidates as $candidate) {
        $image = absolute_public_image((string) $candidate, $documentRoot);
        if ($image !== '') {
            return $image;
        }
    }
    return SITE_ORIGIN . '/assets/toprun-product-1.png';
}

function load_product(string $key, string $catalogPath): ?array
{
    $json = @file_get_contents($catalogPath);
    $products = $json === false ? null : json_decode($json, true);
    if (!is_array($products)) {
        return null;
    }
    $lookup = utf8_lower(trim($key));
    foreach ($products as $product) {
        if (!is_array($product)) {
            continue;
        }
        foreach (['code', 'productCode', 'slug'] as $field) {
            if (utf8_lower(trim((string) ($product[$field] ?? ''))) === $lookup) {
                $status = utf8_lower(trim((string) ($product['status'] ?? '')));
                return $status === 'hidden' ? null : $product;
            }
        }
    }
    return null;
}

function truncate_description(string $text, int $length = 190): string
{
    if (utf8_length($text) <= $length) {
        return $text;
    }
    return rtrim(utf8_substring($text, 0, $length - 1)) . '…';
}

$projectRoot = dirname(__DIR__, 2);
$templatePath = $projectRoot . DIRECTORY_SEPARATOR . 'product.html';
$catalogPath = $projectRoot . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'published-products.json';
$documentRoot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? $projectRoot), '/\\');
$key = trim(rawurldecode((string) ($_GET['p'] ?? '')));
$product = $key !== '' && utf8_length($key) <= 160 ? load_product($key, $catalogPath) : null;
$template = @file_get_contents($templatePath);

if ($template === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Không thể tải trang sản phẩm.';
    exit;
}

$found = is_array($product);
$code = $found ? first_text($product, ['code', 'productCode']) : $key;
$slug = $found ? first_text($product, ['slug']) : '';
$routeKey = $slug !== '' ? $slug : $code;
$canonical = SITE_ORIGIN . '/product/' . rawurlencode($routeKey !== '' ? $routeKey : $key);
$title = $found ? public_product_name($product) : 'Sản phẩm';
$title = $title !== '' ? $title . ' - TopRun' : 'TopRun - Giày và đồ thể thao chính hãng';
$price = $found ? public_product_price($product) : 0.0;
$description = $found ? first_text($product, ['seoDescription', 'shortDescription', 'description']) : '';
if ($description === '' && $found) {
    $description = ($price > 0 ? 'Giá ' . number_format($price, 0, ',', '.') . 'đ. ' : '') . 'Xem hình ảnh, size còn hàng và đặt sản phẩm trực tiếp tại TopRun.';
}
$description = truncate_description($description !== '' ? $description : 'Xem sản phẩm giày và đồ thể thao chính hãng tại TopRun.');
$image = $found ? public_product_image($product, $documentRoot) : SITE_ORIGIN . '/assets/toprun-product-1.png';

$meta = implode("\n", [
    '  <link rel="canonical" href="' . escape_html($canonical) . '">',
    '  <meta name="description" content="' . escape_html($description) . '">',
    '  <meta property="og:type" content="product">',
    '  <meta property="og:site_name" content="TopRun">',
    '  <meta property="og:title" content="' . escape_html($title) . '">',
    '  <meta property="og:description" content="' . escape_html($description) . '">',
    '  <meta property="og:image" content="' . escape_html($image) . '">',
    '  <meta property="og:image:alt" content="' . escape_html($title) . '">',
    '  <meta property="og:url" content="' . escape_html($canonical) . '">',
    $price > 0 ? '  <meta property="product:price:amount" content="' . number_format($price, 0, '.', '') . '">' : '',
    $price > 0 ? '  <meta property="product:price:currency" content="VND">' : '',
    '  <meta name="twitter:card" content="summary_large_image">',
    '  <meta name="twitter:title" content="' . escape_html($title) . '">',
    '  <meta name="twitter:description" content="' . escape_html($description) . '">',
    '  <meta name="twitter:image" content="' . escape_html($image) . '">',
]);

$template = preg_replace('#<title>.*?</title>#is', '<title>' . escape_html($title) . '</title>' . "\n" . $meta, $template, 1) ?? $template;

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=300');
if (!$found) {
    header('X-Robots-Tag: noindex, nofollow');
}
echo $template;

# Order Status Add-on

Add-on nay nam tach rieng khoi giao dien landing page. Landing page chi phat su kien khi co don moi, admin cap nhat don, partner xac nhan mua hang hoac dong hang. Toan bo logic thong bao va action tu kenh chat nam trong `addons/order-status-addon`.

## Muc Tieu

- Theo doi trang thai don hang tu luc khach dat hang den khi giao thanh cong.
- Thong bao cho partner, nhan vien van hanh va khach hang qua cac kenh cau hinh duoc.
- Cho phep partner/nhan vien xac nhan mot so moc quan trong ma khong can sua landing page.
- Giu add-on co the tat/bat bang bien moi truong, khong lam anh huong luong dat hang hien tai.

## Luong Trang Thai De Xuat

1. Khach dat hang tren web.
2. He thong tao don o trang thai `pending`, `payment_pending`, `not_assigned`.
3. Add-on gui thong bao don moi cho partner/nhan vien.
4. Partner xac nhan:
   - `partner_has_stock`: co hang, he thong chuyen sang `stock_confirmed` va giu hang.
   - `partner_out_of_stock`: het hang, he thong chuyen sang `partner_out_of_stock`.
5. Neu co hang, nhan vien/he thong gui thong tin thanh toan cho khach va gioi han giu hang 1 gio.
6. Khi nhan coc, cap nhat `deposit_received` va `payment_confirmed`.
7. Don chuyen sang `waiting_purchase`.
8. Partner mua hang xong, cap nhat `purchase_complete`/`purchased`.
9. Partner dong goi xong, cap nhat `ready_to_ship`/`packed`.
10. Nhan vien tao van don, cap nhat ma van don va trang thai van chuyen.
11. Don duoc theo doi den `shipped`, `delivered`, `completed`.

## Diem Tich Hop Hien Tai

- `POST /api/orders`: sau khi luu don, add-on nhan su kien `order.created`.
- `POST /api/admin/orders`: sau khi admin/Sales Desk cap nhat don, add-on nhan su kien `order.updated`.
- `POST /api/partner-portal/purchases`: khi partner xac nhan da mua hang.
- `POST /api/partner-portal/order-packing`: khi partner xac nhan da dong hang.
- `POST /api/order-status-addon/telegram`: webhook nhan callback tu Telegram inline button.
- `GET /api/order-status-addon/action`: link xac nhan co chu ky, dung cho kenh khong co callback native.

## Cau Hinh

Mac dinh add-on tat:

```env
ORDER_STATUS_ADDON_ENABLED=false
```

Bat add-on va cau hinh URL public:

```env
ORDER_STATUS_ADDON_ENABLED=true
ORDER_STATUS_PUBLIC_BASE_URL=https://toprun.site
ORDER_STATUS_ACTION_SECRET=<chuoi-bi-mat-dai>
```

Telegram:

```env
ORDER_STATUS_TELEGRAM_ENABLED=true
ORDER_STATUS_TELEGRAM_BOT_TOKEN=<bot-token>
ORDER_STATUS_PARTNER_TELEGRAM_CHAT_ID=<chat-id-nhom-partner>
ORDER_STATUS_OPS_TELEGRAM_CHAT_ID=<chat-id-nhom-nhan-vien>
ORDER_STATUS_TELEGRAM_WEBHOOK_SECRET=<chuoi-bi-mat-cho-webhook>
```

Webhook trung gian cho Zalo OA, Viber, CRM hoac automation:

```env
ORDER_STATUS_GENERIC_WEBHOOK_URL=https://example.com/toprun/order-status-webhook
```

## Telegram

Telegram Bot API ho tro `sendMessage` kem `reply_markup.inline_keyboard` va nhan `callback_query` qua webhook. Vi vay co the dat nut `Co hang`, `Het hang`, `Da mua`, `Da dong hang` ngay trong tin nhan.

Khuyen nghi dung Telegram cho nhan vien/partner noi bo vi:

- Bot API de cau hinh va test.
- Nut inline tra ve callback truc tiep cho server.
- Co the bao ve webhook bang secret token.
- Phu hop thao tac nhanh trong nhom van hanh.

## Zalo OA

Zalo phu hop de gui thong bao cho khach hang tai Viet Nam, nhung can luu y:

- Nen dung Zalo Official Account hop le, khong dua vao Zalo ca nhan.
- Tin cham soc khach hang thuong phu thuoc quan he nguoi dung da tuong tac/quan tam OA va chinh sach template.
- Kha nang dat nut/action phu thuoc loai message/template duoc Zalo phe duyet va API hien tai.
- Nen day qua `ORDER_STATUS_GENERIC_WEBHOOK_URL` den mot service rieng phu trach Zalo, de landing khong phu thuoc truc tiep SDK/API Zalo.

## Co Nen Xac Nhan Co Hang Ngay Tren Chat?

Nen lam voi partner/nhan vien noi bo, nhung khong nen coi chat la nguon du lieu duy nhat.

Khuyen nghi:

- Cho phep bam nhanh `Co hang`/`Het hang` tren Telegram hoac link ky so trong Zalo.
- Moi thao tac phai ghi log actor, thoi gian, nguon cap nhat.
- Link xac nhan phai co chu ky, het han ngan, khong dung link cong khai vinh vien.
- Cac buoc tien/van don/hoan tat nen co doi soat o Sales Desk/admin de tranh bam nham.
- Khach hang chi nen nhan thong bao va link thanh toan/theo doi; khong nen duoc bam thay doi trang thai van hanh.

## Huong Mo Rong

- Them adapter `zalo.js` de gui Zalo OA truc tiep khi co thong tin OA/token on dinh.
- Them bang log rieng `order_addon_events` neu muon audit chuyen sau trong MySQL.
- Them auto job het han giu hang 1 gio va nhac thanh toan.
- Them webhook tu ngan hang/payment gateway de tu dong chuyen `payment_confirmed`.

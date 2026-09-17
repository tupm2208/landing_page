/**
 * @file The module registry: every module this server can run, in load order.
 *
 * A static list rather than a directory scan: TypeScript then checks each manifest, and a typo in
 * a directory name cannot silently drop a module. Which of these actually run on a given shop is
 * decided by the composition root (`MODULE_BAT`).
 *
 * Order matters only for readability — services are wired after all modules are loaded.
 */

import type { AnyManifest } from "../contract";
import { manifest as congBoNao } from "./cong-bo-nao/module";
import { manifest as ctv } from "./ctv/module";
import { manifest as dangBai } from "./dang-bai/module";
import { manifest as donKhach } from "./don-khach/module";
import { manifest as gianHang } from "./gian-hang/module";
import { manifest as hangKho } from "./hang-kho/module";
import { manifest as hopThu } from "./hop-thu/module";
import { manifest as khungNenTang } from "./khung-nen-tang/module";
import { manifest as muaHo } from "./mua-ho/module";
import { manifest as quanTri } from "./quan-tri/module";
import { manifest as thongKe } from "./thong-ke/module";
import { manifest as tienDoiSoat } from "./tien-doi-soat/module";
import { manifest as tinhNangShop } from "./tinh-nang-shop/module";
import { manifest as troLyAi } from "./tro-ly-ai/module";
import { manifest as tuVanSize } from "./tu-van-size/module";
import { manifest as vanChuyen } from "./van-chuyen/module";
import { manifest as xuongNoiDung } from "./xuong-noi-dung/module";

export const BUILTIN_MODULES: AnyManifest[] = [
  congBoNao, ctv, dangBai, donKhach, gianHang, hangKho, hopThu, khungNenTang, muaHo, quanTri, thongKe, tienDoiSoat, tinhNangShop, troLyAi, tuVanSize, vanChuyen, xuongNoiDung
];

export { congBoNao, ctv, dangBai, donKhach, gianHang, hangKho, hopThu, khungNenTang, muaHo, quanTri, thongKe, tienDoiSoat, tinhNangShop, troLyAi, tuVanSize, vanChuyen, xuongNoiDung };

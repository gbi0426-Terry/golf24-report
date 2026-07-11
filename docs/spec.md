# Golf24 教練預約平台 — 功能規格（Phase 1）

本文件是實作依據。與 `AGENTS.md` 搭配閱讀。設計 / 商業脈絡另見 repo 根目錄的
`index.html`（學員落地頁）與 `report.html`（完整商業提案）。

---

## 1. 角色

| 角色 | 能做什麼 |
|------|----------|
| 學員（訪客，免登入） | 瀏覽課程、送出報名、（收到連結後）付訂金 |
| 店家 / 場主 | 後台查看與確認預約、改期、標記場地、退款註記、看營收 |
| 教練 | （Phase 1 可先不做登入）資料由店家維護 |

Phase 1 只有「店家後台」需要登入（用 Supabase Auth，單一 admin 帳號即可）。

---

## 2. 學員預約流程（狀態機）

```
送出報名  →  pending（待確認）
              │  店家在後台喬好時間、LINE 通知學員
              ▼
           confirmed（已確認，發訂金連結）
              │  學員付訂金 / 尾款
              ▼
            paid（已付款）  →  completed（已上課）
    任何階段可轉：cancelled（取消）/ no_show（爽約）
```

- 學員送出時**不選精確時段**，只選「日期 + 上午/下午/晚上」。
- `confirmed` 由店家人工設定確切 `start_at`（避免雙重預約）。
- 狀態變更要留時間戳與操作者。

---

## 3. 資料表（Supabase / Postgres）

> 命名用英文複數、snake_case。所有表含 `id uuid pk`、`created_at`、`updated_at`。

### members（會員 / 學員）
| 欄位 | 型別 | 說明 |
|------|------|------|
| name | text | 姓名 |
| phone | text | 手機（用來認人，建索引） |
| line_id | text | LINE ID |
| level | text | 程度：完全沒碰過 / 打過幾次 / 有固定在練 |
| source | text | 來源：現場 QR / 朋友介紹 / LINE / Google / 其他 |
| note | text | 備註 |

### coaches（教練）
| 欄位 | 型別 | 說明 |
|------|------|------|
| name | text | 姓名 |
| specialty | text | 專長（新手 / 揮桿 / 兒童 / 數據…） |
| bio | text | 簡介 |
| certifications | text | 證照 |
| revenue_share | numeric | 分潤比例（0–1，僅記錄，不自動結算） |
| status | text | active / inactive |

### courses（課程商品）
| 欄位 | 型別 | 說明 |
|------|------|------|
| name | text | 課程名稱 |
| type | text | 新手 / 揮桿 / 兒童 / 商務 |
| duration_min | int | 時長（分鐘） |
| price | int | 售價 TWD |
| deposit | int | 訂金 TWD |
| target | text | 適合對象 |
| active | bool | 是否上架 |

### bookings（預約）
| 欄位 | 型別 | 說明 |
|------|------|------|
| member_id | uuid fk→members | |
| coach_id | uuid fk→coaches | 可為 null（還不確定教練） |
| course_id | uuid fk→courses | |
| preferred_date | date | 學員希望日期 |
| preferred_slot | text | 上午 / 下午 / 晚上 |
| start_at | timestamptz | 店家確認後的確切時間，可為 null |
| status | text/enum | pending / confirmed / paid / completed / cancelled / no_show |
| venue_status | text | 場地確認：unchecked / confirmed（人工） |
| admin_note | text | 店家備註 |

### payments（付款）
| 欄位 | 型別 | 說明 |
|------|------|------|
| booking_id | uuid fk→bookings | |
| order_no | text | 綠界訂單編號 |
| amount | int | 金額 TWD |
| kind | text | deposit（訂金）/ full（全額）|
| method | text | ecpay / cash / transfer |
| status | text | pending / paid / refunded |
| paid_at | timestamptz | |

### lesson_records（課後紀錄）
| 欄位 | 型別 | 說明 |
|------|------|------|
| booking_id | uuid fk→bookings | |
| coach_id | uuid fk→coaches | |
| focus | text | 本堂重點 |
| improvement | text | 改善建議 |
| video_url | text | 揮桿影片連結（Phase 1 可先留欄位不做上傳）|
| next_goal | text | 下次目標 |

建議用 enum type 定義 `booking_status` 與 `payment_status`。

---

## 4. 頁面 / API

### 學員端（public）
- `/`：落地頁（移植 `index.html`）。課程、教練、FAQ 由 DB 驅動。
- `POST /api/bookings`：建立 member（依 phone upsert）+ booking，狀態 `pending`。
- `/pay/[bookingId]`：導向綠界付款；`POST /api/ecpay/callback` 接回呼寫 `payments`。

### 店家後台（需登入，`/admin/*`）
- 預約列表（可依狀態篩選）、預約詳情。
- 動作：設定 `start_at` + `venue_status=confirmed` →（觸發 LINE 通知學員 + 發訂金連結）、改期、取消、標記完成 / 爽約。
- 課程 / 教練 CRUD。
- 簡單營收檢視（本月 confirmed / paid 堂數與金額）。

### LINE 通知（Messaging API）
- Phase 1 最小可行：新報名進來 → push 給店家。
- 進階：confirmed 時 push 給學員（需學員先加官方帳號並綁定，設計時保留擴充點）。

---

## 5. 綠界 ECPay 重點

- 用「訂金」金額建立訂單（`courses.deposit`）。
- 需要：MerchantID、HashKey、HashIV（放 `.env.local`）。
- 回呼驗證 CheckMacValue，成功才把 `payments.status=paid`、`bookings.status=paid`。
- 測試用綠界測試環境（stage）金鑰。

---

## 6. 驗收標準（Phase 1 完成的定義）

- [ ] 學員能在落地頁送出報名，資料寫進 Supabase。
- [ ] 店家能在 `/admin` 看到報名、設定確切時間並標記場地已確認。
- [ ] 確認後能產生綠界訂金連結，付款成功會回寫 `payments` 與 `bookings`。
- [ ] 新報名會 LINE 通知店家。
- [ ] 課程 / 教練由資料表驅動，改資料不用改程式。
- [ ] 秘密金鑰不在 git 裡；有 `.env.example`。

---

## 7. KPI（之後 Dashboard 參考，Phase 1 不強制）

每月 QR 掃描、體驗課預約數、正式課轉換率、回購率、爽約率(<8%)、場地利用率。

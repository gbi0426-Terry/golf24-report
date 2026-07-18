# Golf24 教練預約平台 — 功能規格（Phase 1）

本文件是實作依據。與 `AGENTS.md` 搭配閱讀。設計 / 商業脈絡另見 repo 根目錄的
`index.html`（學員落地頁）與 `report.html`（完整商業提案）。

---

## 1. 產品方案與角色

本專案採用 **方案 3：LINE LIFF 預約系統**。

客戶實際流程：

```
球室看到 QR Code
→ 掃描後開啟 LINE LIFF 預約頁
→ LINE Login / LIFF 取得學員 LINE 身分
→ 選課程、希望日期時段、指定教練（可選）
→ 送出預約
→ 系統個別通知指定教練、老闆、管理者
→ 店家確認場地與時間後，LINE 發確認與訂金連結
```

QR Code 正式入口應使用 LIFF URL：

```
https://liff.line.me/{LIFF_ID}?source=wall_qr&campaign={campaign}
```

現有 GitHub Pages `index.html` 只作為 Phase 0 展示頁與設計參考；正式預約系統要部署到可執行後端的環境（建議 Vercel）。

| 角色 | 能做什麼 |
|------|----------|
| 學員（LINE LIFF） | 掃 QR、LINE 登入、瀏覽課程、送出預約、（收到連結後）付訂金 |
| 店家 / 場主 | 後台查看與確認預約、改期、標記場地、退款註記、看營收 |
| 教練 | 綁定 LINE userId，接收被指定或被分配的預約通知 |
| 管理者 | 綁定 LINE userId，接收所有新預約通知與營運提醒 |

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
- 學員可選指定教練；若不指定，由店家後台分配。
- `confirmed` 由店家人工設定確切 `start_at`（避免雙重預約）。
- 狀態變更要留時間戳與操作者。
- 新預約建立後，系統立即觸發個人 LINE 通知。

---

## 3. 資料表（Supabase / Postgres）

> 命名用英文複數、snake_case。所有表含 `id uuid pk`、`created_at`、`updated_at`。

### members（會員 / 學員）
| 欄位 | 型別 | 說明 |
|------|------|------|
| name | text | 姓名 |
| phone | text | 手機（用來認人，建索引） |
| line_user_id | text | LINE 平台 userId，唯一索引；不是客人自填的 LINE ID |
| line_display_name | text | LINE 顯示名稱 |
| line_picture_url | text | LINE 頭像 URL |
| line_friend | bool | 是否已加官方 LINE，可由 LIFF friendship 或 webhook 更新 |
| level | text | 程度：完全沒碰過 / 打過幾次 / 有固定在練 |
| source | text | 來源：現場 QR / 朋友介紹 / LINE / Google / 其他 |
| campaign | text | QR Code campaign 參數，例如 swing_check / trial |
| note | text | 備註 |

### coaches（教練）
| 欄位 | 型別 | 說明 |
|------|------|------|
| name | text | 姓名 |
| specialty | text | 專長（新手 / 揮桿 / 數據 / 入門…） |
| bio | text | 簡介 |
| certifications | text | 證照 |
| revenue_share | numeric | 分潤比例（0–1，僅記錄，不自動結算） |
| line_user_id | text | 教練 LINE userId，用於個人 push |
| notify_enabled | bool | 是否接收新預約通知 |
| status | text | active / inactive |

### admins（管理者 / 老闆 / 內部通知收件人）
| 欄位 | 型別 | 說明 |
|------|------|------|
| name | text | 姓名 |
| role | text | owner / manager / operator |
| line_user_id | text | 管理者 LINE userId，用於個人 push |
| notify_enabled | bool | 是否接收通知 |
| status | text | active / inactive |

### courses（課程商品）
| 欄位 | 型別 | 說明 |
|------|------|------|
| name | text | 課程名稱 |
| type | text | trial / swing_check / package |
| duration_min | int | 時長（分鐘） |
| price | int | 售價 TWD |
| deposit | int | 訂金 TWD |
| target | text | 適合對象 |
| package_size | int | 正式課程堂數；體驗 / 檢測可為 1 |
| completion_days | int | 需完成天數；正式課程一期五堂為 30 |
| active | bool | 是否上架 |

Phase 1 課程預設：

| 課程 | 價格 | 說明 |
|------|------|------|
| 新手體驗課 | NT$1,500 / 單次 | 第一次接觸高爾夫，建立基礎動作 |
| 揮桿檢測 | NT$1,500 / 單次 | 檢查揮桿問題與改善方向 |
| 正式課程一期 | 價格由店家設定 | 一期五堂，須於一個月內完成 |

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
| source | text | QR / LINE / 手動建立 |
| campaign | text | QR campaign 參數 |

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

### notifications（通知紀錄）
| 欄位 | 型別 | 說明 |
|------|------|------|
| booking_id | uuid fk→bookings | 關聯預約 |
| recipient_type | text | coach / admin / member |
| recipient_id | uuid | 對應 coaches / admins / members id |
| line_user_id | text | 實際推播目標 |
| event | text | booking_created / coach_assigned / booking_confirmed / payment_link_sent |
| status | text | pending / sent / failed |
| error_message | text | 失敗原因 |
| sent_at | timestamptz | 發送時間 |

建議用 enum type 定義 `booking_status` 與 `payment_status`。

---

## 4. 頁面 / API

### 學員端（public）
- `/`：落地頁（移植 `index.html`）。課程、教練、FAQ 由 DB 驅動。
- `/booking` 或 `/liff/booking`：LINE LIFF 預約頁，執行 `liff.init()`，取得 profile / friendship。
- `POST /api/bookings`：建立 member（依 `line_user_id` 優先，其次 phone upsert）+ booking，狀態 `pending`。
- `/pay/[bookingId]`：導向綠界付款；`POST /api/ecpay/callback` 接回呼寫 `payments`。

### LINE 綁定頁
- `/bind/coach`：教練加官方 LINE 後，用 LIFF / LINE Login 綁定 `coaches.line_user_id`。
- `/bind/admin`：老闆與管理者綁定 `admins.line_user_id`。
- 綁定頁需有安全碼或一次性 token，避免任何人自行綁成教練 / 管理者。

### 店家後台（需登入，`/admin/*`）
- 預約列表（可依狀態篩選）、預約詳情。
- 動作：設定 `start_at` + `venue_status=confirmed` →（觸發 LINE 通知學員 + 發訂金連結）、改期、取消、標記完成 / 爽約。
- 課程 / 教練 CRUD。
- 簡單營收檢視（本月 confirmed / paid 堂數與金額）。

### LINE 通知（Messaging API）
- 採 **A 方案：個人 LINE push**，不採群組通知。
- 新報名進來：
  - 有指定教練：push 給該教練 + 所有 `notify_enabled=true` 的管理者。
  - 未指定教練：push 給所有 `notify_enabled=true` 的管理者。
- 店家後台分配教練後：push 給被分配教練。
- 店家確認場地與時間後：push 給學員，附確認資訊與訂金付款連結。
- 每次通知都寫入 `notifications`，保留成功 / 失敗結果。

---

## 5. 綠界 ECPay 重點

- 用「訂金」金額建立訂單（`courses.deposit`）。
- 需要：MerchantID、HashKey、HashIV（放 `.env.local`）。
- 回呼驗證 CheckMacValue，成功才把 `payments.status=paid`、`bookings.status=paid`。
- 測試用綠界測試環境（stage）金鑰。

---

## 6. 驗收標準（Phase 1 完成的定義）

- [ ] 學員能在落地頁送出報名，資料寫進 Supabase。
- [ ] 學員能從 LIFF 預約頁登入並保存 `line_user_id`。
- [ ] 店家能在 `/admin` 看到報名、設定確切時間並標記場地已確認。
- [ ] 教練、老闆、管理者能完成 LINE userId 綁定。
- [ ] 新預約能依 A 方案個別通知指定教練、老闆、管理者。
- [ ] 確認後能產生綠界訂金連結，付款成功會回寫 `payments` 與 `bookings`。
- [ ] 課程 / 教練由資料表驅動，改資料不用改程式。
- [ ] 秘密金鑰不在 git 裡；有 `.env.example`。

---

## 7. KPI（之後 Dashboard 參考，Phase 1 不強制）

每月 QR 掃描、體驗課預約數、正式課轉換率、回購率、爽約率(<8%)、場地利用率。

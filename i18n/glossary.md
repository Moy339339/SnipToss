# SnipToss English glossary

Terms used in `i18n/locales/en.json` (docs/adr/0001-i18n.md). New English text follows this table; other languages translate from these terms.

## Objects

| Chinese | English | Notes / where used |
|---|---|---|
| 批注 (one annotation) | note | Cards, "Add Note Here…", "Edit Selected Note", "Notes Panel". Always lower-case in running text. |
| 批注 (the activity / a section name) | annotate / Annotations | Verb "annotate" everywhere. "Annotations" only as a section title: Settings page `settings.annotate.title`, Advanced > `settings.advanced.notes`, shortcut group `sc.group.notes`. Menu bar title is "Annotate". Do not use "annotation" for a single item (use "note"). |
| 批注文件 | notes file (plural: notes files) | The JSON file in `.sniptoss` holding all notes of one item. Used in `app.sync.external`, `app.file.*`, `ai.review.unreadable`. In AI text "JSON file" is fine because it is literal. |
| 批注栏 | notes panel | Right panel. Menu: "Notes Panel". |
| 素材栏 / 左栏 | Library | Left panel (the code already says `library.*`). View > "Library", "Show / hide the library", "right-click it in the library". |
| 素材 | item | One image/video/PDF file being annotated. Never "material" as a standalone noun. `kind.*` gives the type. |
| 素材列表 | library | The list in that panel: "Clear Library…", "Clear the library?", "Couldn't load the library". Not "material list" / "item list". |
| 项目 | project | A folder that contains `.sniptoss`; top-level group in the library. |
| 文件夹 | folder | |
| 批注文件夹 `.sniptoss` | notes folder | `menu.file.revealNotes` "Open Notes Folder (.sniptoss)". |
| 画面 | canvas (UI) / frame (AI text) | UI: `app.area.stage`, `sc.group.canvas`, "Show Resolved Notes on Canvas". AI-facing position text says "of the frame" (`ai.where.*`) - keep, it describes the image frame. |
| 草稿 | draft | An unfinished note. |
| 批注输入框 / 批注框 / 小窗 | note box | `sc.notes.save`, `sc.capture.notes`, `settings.annotate.autoCompose`. When it names the part of the window that failed (`app.area.composer`) it is "note editor". |

## Comment types

| Chinese | English | Notes |
|---|---|---|
| 整体意见 | overall comment | Title "Overall Comment", toolbar/card short form "Overall". Note about the whole item, no position. Text for AI and image file names use the full form "overall comment". |
| 时间点意见 | timestamped comment | Video only: a note at a moment or over a range of the video, no position. Title "Timestamped Comment", section "Timestamped notes", toolbar/card short form "Timestamped". Shortcut T. Overall comment on a video now means the whole video (no time). |
| 文件夹意见 | folder comment | "Add Folder Comment…", "{count} folder comments". Applies to every item in the folder (including subfolders). |
| 整个文件夹 | Whole folder | Marker text the AI is told to look for: `ai.anchor.wholeFolder`, `ai.handoff.folderHint`. `ai.review.folderSuffix` was "(whole folder)" -> "(Whole folder)" so the marker is spelled one way. |
| 整个项目 | Project (scope toggle) / Entire Project (menu) / whole project folder (image title) | Fine; different widths. |

## Status

| Chinese | English | Notes |
|---|---|---|
| 待处理 | open | "open notes". Never "pending" or "unresolved" (the menu command is "Library: Show Only Items with Open Notes"). |
| 已处理 | resolved | Umbrella for done + won't fix: "Show resolved notes". AI text writes "(resolved: done)" / "(resolved: won't fix)". |
| 已改 | done | Status label "Done"; command "Mark as Done". |
| 不改 | won't fix | Status "Won't fix"; command "Mark as Won't Fix" (Title Case in menus). Hyphenated when it modifies a noun: "won't-fix notes". |
| 重新打开 | reopen | |
| 勾选 / 取消勾选 | check / uncheck | The checkbox on a card ("checked notes"). Different from 选中 = select. |
| 选中 | select / selected | One note highlighted. |
| 新 | New | Marker on files that appeared after the folder was added. |

## Marks and tools

| Chinese | English | Notes |
|---|---|---|
| 标记 | mark | Any drawn shape (pin, rectangle, arrow, freehand). "Mark drawn.", "Move mark". |
| 图钉 | Pin | Tool that places a point mark. Same word as list action below. |
| 置顶 (list) | Pin to Top / Unpin | **Disambiguation:** menu was "Pin" - identical to the tool. -> "Pin to Top". |
| 窗口置顶 | Always on Top | Window menu. |
| 选择 / 抓手 / 矩形 / 画笔 / 箭头 | Select / Hand / Rectangle / Pen / Arrow | `tool.*`. Pen in AI text: "Freehand mark". |
| 椭圆 / 马赛克 / 文字 | Ellipse / Pixelate / Text | Capture tools (Pixelate, not the loanword Mosaic). |
| 区域 / 位置 | Region / Point (Arrow) | `ai.where.rect` "Region:", `ai.where.point` "Point:", `ai.where.arrow`. |
| N 处（一条批注标了几处） | N marks (interface) / N places (AI text) | ADR-0009. Interface counts marks (`composer.places`, `card.places`: "3 marks"); text for agents counts places (`ai.where.many`: "3 places — …"). Other languages use their word for mark in the interface and a neutral "place / location" word in AI text (ja か所, ko 곳, de Stellen, fr endroits, es lugares, it posizioni, pt-BR locais, ru мест). |
| 时间段 / 时刻 | range / time | Video notes. "range" = start to end. Link buttons in the note box: "Set as range" (设为时间段), "Set time" (指定时刻); avoid "moment" in labels. |
| 视频位置 | Video time | |
| 类别 | category | |
| 修改 / 删除 / 新增 / 疑问 | Change / Remove / Add / Question | Categories. AI text says "“Change” means modify the marked content as described". Note "Remove" (category, content removal) vs "Delete" (delete a note) - intentional, keep. |

## Copying / AI

| Chinese | English | Notes |
|---|---|---|
| 复制成文字 | Copy as Text | Button/menu Title Case; sentence form in tooltips. For agents that read local files. |
| 复制成图片 | Copy as Images | For web-based AI and chat apps. |
| 网页版 AI | web-based AI | Not "web AI" (one place) and never a product name. |
| 聊天软件 | chat app(s) | Never name WeChat/QQ. |
| AI (reads files) | AI agents / AI | "AI agents" when it reads `.sniptoss` files; "an AI tool" when it receives a pasted image/text; "AI" alone is fine in short strings. |
| 批注编号 | Note ID | |
| 截图 (per-note image stored in `.sniptoss`) | snapshot | Created by SnipToss for each note. |
| 截图 (the result of Screen Capture) | screenshot | Never "snapshot". |
| 截图批注 | Screen Capture (feature, settings page, overlay title) / Capture (title-bar button) / Capture Screen… (menu, tray verb) | Lower-case "screen capture" in running text. Consistent today. |
| 附加说明 | Extra instructions | |
| 诊断信息 | diagnostic info | |

## UI / platform

| Chinese | English | Notes |
|---|---|---|
| 资源管理器 | File Explorer | Windows 11 name. Catalog mixed "Explorer" (7 keys) and "File Explorer" (1). -> File Explorer everywhere. |
| 托盘 | tray | |
| 设置 | Settings | Page names: General, Annotations, Copying, System, Shortcuts, Advanced, About. Paths written as "Settings → Advanced → Skipped folders". |
| 快捷键 | shortcut | List dialog: "Keyboard Shortcuts". Hotkey text: "Ctrl Shift A" (space separated, house style). |
| 界面 | interface | "UI" only in the About page ("UI built"). |
| 程序 | app | |
| 日志 | log | "Open Log Folder". |
| 本机 | this computer | |
| 知道了 | OK | Dismiss button on notices (Windows convention; "Got it" is too casual). |
| 完成 (capture overlay) | Finish | Was "Done" - collides with the note status "Done". |
| 恢复默认 | Restore Defaults (settings) / Reset (one setting, e.g. the capture folder) | |
| 移除 vs 删除 | Remove (list entries, files kept) / Delete (notes) | Consistent; keep. |
| 重新载入 / 重新读取 | Reload | One English word for both; fine. |
| 定位 (re-link a moved item) | Locate… | Not to be confused with "select in list". |

## Capitalization rules observed (keep)

- Title Case: menu items, buttons, dialog titles (`composer.title.*`, `Add Files…`, `Open Log Folder`, `Restore Defaults`).
- Sentence case: tooltips, descriptions, toasts, settings labels, shortcut-list rows, step headings.
- References to a UI label inside a sentence use the label's own capitalization and no quotes: Copy as Text, Select (tool), Solid (option), File menu. Quote (curly “ ”) only user data (names, paths) or when the label would be ambiguous in the sentence.
- Curly quotes “ ” only; straight quotes appeared in two settings descriptions (fixed).
- `{this}` (from `app.kind.this`) is always lower-case ("this image") -> never place it at the start of a sentence.

## Other languages

Term choices made when the second-tier languages were first translated (first-pass translations, not yet reviewed by native speakers — docs/adr/0001-i18n.md item 4). Keep new strings consistent with them; corrections welcome.

### 繁體中文 (`zh-TW`)

| zh-CN | zh-TW | 備註 |
|---|---|---|
| 超级批注 | 超級批註 | `brand.name`；技術名 SnipToss 照舊 |
| 批注（一則 / 動詞） | 批註 | 量詞用「則」：5 則批註 |
| 批注栏 / 素材栏 | 批註欄 / 素材欄 | 兩側面板保留「面板」 |
| 素材 | 素材 | 對應 en 的 item；「項目」只當泛稱的一項 |
| 素材列表 / 列表 | 素材清單 / 清單 | |
| 项目（project） | 專案 | |
| 文件 / 文件夹 | 檔案 / 資料夾 | 批注文件 = 批註檔案；文件名 = 檔名 |
| 窗口 / 屏幕 / 画面 | 視窗 / 螢幕 / 畫面 | |
| 设置 / 默认 / 恢复默认 | 設定 / 預設 / 還原預設值 | |
| 快捷键 / 快捷方式 | 快速鍵 / 捷徑 | 桌面捷徑用「捷徑」 |
| 托盘 / 资源管理器 | 系統匣 / 檔案總管 | |
| 右键单击 / 单击 / 双击 | 按一下滑鼠右鍵 / 按一下 / 按兩下 | 拖动 = 拖曳 |
| 复制 / 粘贴 / 剪贴板 | 複製 / 貼上 / 剪貼簿 | 複製成文字 = 複製為文字 |
| 保存 / 撤销 / 重做 | 儲存 / 復原 / 重做 | |
| 已改 / 不改 / 已处理 / 待处理 | 已修改 / 不修改 / 已處理 / 待處理 | 標記動詞用「標示為」 |
| 整体意见 / 文件夹意见 | 整體意見 / 資料夾意見 | |
| 时间点意见 | 時間點意見 | 只有影片有 |
| 勾选 / 选中 | 勾選 / 選取 | 選擇工具 = 選取 |
| 图钉 / 抓手 / 画笔 / 马赛克 | 圖釘 / 手形 / 畫筆 / 馬賽克 | |
| 视频 / 帧 / 时间段 / 时刻 | 影片 / 影格 / 時間範圍 / 時間點 | |
| 日志 | 記錄檔 | 日誌資料夾 = 記錄檔資料夾 |
| 程序 / 界面 | 程式 / 介面 | |
| 退出 / 全屏 | 結束 / 全螢幕 | |
| 诊断信息 / 反馈 | 診斷資訊 / 意見回饋 | 報告問題 = 回報問題 |
| 运行环境 / 开发者工具 | 執行環境 / 開發人員工具 | WebView2 Runtime 照微軟官方叫「WebView2 執行階段」 |
| 本机 / 此电脑 | 本機 / 這台電腦 | |

### 日本語 (`ja`)

| English | 日本語 | 備考 |
|---|---|---|
| note | メモ | 1 件の批注。「注釈」は節名・動詞（注釈を付ける）にのみ使用 |
| annotate / Annotations | 注釈を付ける / 注釈 | メニュー名、設定ページ名、ショートカット グループ名 |
| notes file / notes panel / notes folder | メモ ファイル / メモ パネル / メモ フォルダー | カタカナ複合語は半角スペースで区切る (Microsoft スタイル) |
| library | ライブラリ | 左パネルとそのリスト |
| item | 項目 | 注釈対象の 1 ファイル |
| project / folder | プロジェクト / フォルダー | |
| canvas | キャンバス | AI 向け文面の "frame" は「画面」 |
| draft | 下書き | |
| note box | メモ ボックス | 入力ウィンドウ。エラー領域名は「メモ エディター」 |
| overall comment / folder comment | 全体コメント / フォルダー コメント | 短縮形 "Overall" は「全体」 |
| timestamped comment | 時点コメント | 短縮形「時点」。動画のみ。「時刻」は時計の時刻なので使わない |
| Whole folder | フォルダー全体 | AI が探すマーカー文字列。全箇所で同じ表記 |
| open / resolved | 未対応 / 解決済み | 解決済み = 対応済み + 対応不要 |
| done / won't fix / reopen | 対応済み / 対応不要 / 再度開く | |
| check / uncheck | チェック / チェックを外す | 選択 (select) とは別 |
| mark | マーク | |
| Pin (tool) / Pin to Top | ピン / 先頭に固定 | 固定を解除 = Unpin |
| Select / Hand / Rectangle / Pen / Arrow | 選択 / 手のひら / 四角形 / ペン / 矢印 | |
| Ellipse / Pixelate / Text | 楕円 / モザイク / テキスト | 日本語ではモザイクが標準語 |
| range / time (video) | 時間範囲 / 再生位置（ある一点は「時点」） | |
| category: Change / Remove / Add / Question | カテゴリ: 変更 / 削除 / 追加 / 質問 | カテゴリの「削除」はメモの「削除 (Delete)」と同語 |
| Copy as Text / Copy as Images | テキストとしてコピー / 画像としてコピー | |
| web-based AI / chat app / AI agent | Web 版 AI / チャット アプリ / AI エージェント | |
| snapshot / screenshot | スナップショット / スクリーンショット | 区別を維持 |
| Screen Capture / Capture | 画面キャプチャ / キャプチャ | 完了 = Finish |
| Remove (list entry) / Delete (note) | 除外 / 削除 | リストから除外してもファイルは残る |
| File Explorer / tray | エクスプローラー / 通知領域 | |
| shortcut (key) | ショートカット キー | Keyboard Shortcuts = キーボード ショートカット |
| Settings pages | 全般 / 注釈 / コピー / システム / ショートカット キー / 詳細設定 / バージョン情報 | |
| interface / app / this computer | インターフェイス / アプリ / この PC | |
| Restore Defaults / Reset | 既定値に戻す / リセット | |
| Locate… | 場所を指定… | |
| Always on Top | 常に手前に表示 | |

### 한국어 (`ko`)

| English | 한국어 | 비고 |
|---|---|---|
| note | 메모 | 한 건. 활동/섹션 이름(Annotate, Annotations)도 "메모"로 통일("주석"은 코드 주석과 혼동되어 사용하지 않음) |
| annotate (verb) | 메모 남기기 | |
| mark (drawn shape) | 마커 | "표시"는 Show/Display와 겹쳐 사용하지 않음 |
| snapshot (per-note image) | 스냅샷 | |
| screenshot (Screen Capture result) | 스크린샷 | |
| Screen Capture / Capture | 화면 캡처 / 캡처 | 제목 표시줄 단추는 "캡처" |
| item | 항목 | |
| library | 라이브러리 | 왼쪽 패널 |
| Notes panel | 메모 패널 | |
| canvas | 캔버스 | |
| project / folder | 프로젝트 / 폴더 | |
| overall comment | 전체 의견 | |
| timestamped comment | 시점 의견 | 비디오만 |
| folder comment | 폴더 의견 | |
| Whole folder (AI marker) | 폴더 전체 | ai.* 문구에서 한 가지 표기 |
| open (notes) | 미처리 | "미처리 메모" |
| resolved | 처리됨 | 완료 + 수정 안 함의 총칭 |
| done / won't fix | 완료 / 수정 안 함 | |
| reopen | 다시 열기 | |
| check / uncheck (card checkbox) | 체크 / 체크 해제 | "선택(select)"과 구분 |
| category | 분류 | 변경 / 제거 / 추가 / 질문 |
| Copy as Text / Copy as Images | 텍스트로 복사 / 이미지로 복사 | |
| web-based AI / chat apps | 웹 기반 AI / 메신저 앱 | |
| AI agents | AI 에이전트 | |
| Remove (list) / Delete (note) | 제거 / 삭제 | 영어와 같은 구분 유지 |
| Pin to Top / Unpin | 맨 위에 고정 / 고정 해제 | 도구 Pin은 "핀" |
| File Explorer | 파일 탐색기 | |
| tray | 알림 영역 | 종료 메뉴는 "끝내기" |
| shortcut (keyboard) | 바로 가기 키 | |
| context menu / right-click | 상황에 맞는 메뉴 / 마우스 오른쪽 단추로 클릭 | |
| Finish (capture overlay) | 마침 | 상태 "완료"와 구분 |
| Locate… | 위치 지정... | |
| range / time (video) | 구간 / 시점 | |
| Reload / Refresh / Retry | 다시 로드 / 새로 고침 / 다시 시도 | |

### Français (`fr`)

| English | French | Notes |
|---|---|---|
| note | note (f.) | one annotation; "Annotations" only as a section title; menu "Annotate" -> "Annoter" |
| notes file | fichier de notes | notes folder -> dossier de notes |
| notes panel | panneau des notes | |
| library | bibliothèque | left panel |
| item | élément | never "matériau" |
| project / folder | projet / dossier | |
| canvas | canevas | image/video area |
| snapshot (per-note image) | instantané | distinct from screenshot |
| screenshot / Screen Capture | capture d'écran | button "Capture", verb "Capturer l'écran…" |
| mark (drawn shape) | repère | pin = Épingle, pen = Stylo, freehand = tracé à main levée |
| overall comment | commentaire général | short form "Général" |
| timestamped comment | commentaire horodaté | short form "Horodaté"; video only |
| folder comment | commentaire de dossier | "Whole folder" -> "Dossier entier" |
| open (note) | à traiter | "notes à traiter" |
| resolved | traitée | umbrella for done + won't fix |
| Done | Fait | "Marquer comme fait" |
| Won't fix | Sans suite | "Classer sans suite" |
| Reopen | Rouvrir | |
| check / uncheck | cocher / décocher | |
| Copy as Text / Images | Copier en texte / en images | |
| web-based AI / chat app | IA web / application de messagerie | AI agents -> agents IA |
| Pin to Top / Unpin | Épingler en haut / Désépingler | Always on Top -> Toujours au premier plan |
| Remove (list) / Delete (note) / category Remove | Retirer / Supprimer / Retirer | category verbs: Changer, Retirer, Ajouter, Question |
| range / time (video) | plage / instant ("Temps vidéo") | |
| tray | zone de notification | Windows term |
| Clipboard / File Explorer | Presse-papiers / Explorateur de fichiers | |
| Settings | Paramètres | pages: Général, Annotations, Copie, Système, Raccourcis, Avancé, À propos |
| log | journal | |
| Finish (capture) / OK | Terminer / OK | |
| Restore Defaults / Reset | Rétablir par défaut / Réinitialiser | |
| Shift, Enter, Esc, Delete, Wheel | Maj, Entrée, Échap, Suppr, molette | |

### Deutsch (`de`)

| English | German | Notes |
|---|---|---|
| note | Notiz | Notizbereich (notes panel), Notizdatei, Notizordner, Notizfeld (note box), Notiz-ID |
| annotate (verb / menu) | annotieren / Annotieren | settings page, shortcut group and Advanced section "Annotations" = Notizen |
| overall comment | Gesamtkommentar | short form: Gesamt |
| timestamped comment | Zeitpunktkommentar | short form: Zeitpunkt; nur Video |
| folder comment | Ordnerkommentar | marker "Whole folder" = Gesamter Ordner |
| item | Element | "this image" etc. always in a case where nominative = accusative (dieses Bild / diese Präsentation) |
| library | Bibliothek | left panel; list actions use "Liste" (Aus Liste entfernen) |
| project | Projekt | |
| canvas | Arbeitsfläche | AI text: "of the frame" = im Bild |
| snapshot | Momentaufnahme | per-note image; screenshot stays Screenshot |
| screen capture | Bildschirmaufnahme | button: Aufnehmen; menu: Bildschirm aufnehmen… |
| open / resolved / done / won't fix | offen / abgeschlossen / Erledigt / Nicht ändern | resolved = umbrella for done + won't fix |
| check / uncheck | anhaken / Haken entfernen | angehakte Notizen; select = auswählen |
| mark | Markierung | Pin tool = Stecknadel; Pin to Top = Oben anheften |
| range / time | Zeitraum / Zeitpunkt | Video time = Videozeit |
| Copy as Text / Images | Als Text kopieren / Als Bilder kopieren | |
| web-based AI / AI agents | webbasierte KI / KI-Agenten | chat app = Chat-App |
| File Explorer | Datei-Explorer | tray = Infobereich |
| shortcut | Tastenkombination | keys: Strg, Umschalt, Alt, Eingabe, Esc, Tab, Entf, Rücktaste, Leertaste, Mausrad, Pos1, Ende |
| Remove / Delete | Entfernen / Löschen | Clear = Leeren |
| Retry / Reload / Refresh / Redo | Erneut versuchen / Neu laden / Aktualisieren / Wiederholen | |
| Always on Top | Immer im Vordergrund | |
| log | Protokoll | Protokollordner, Protokolldatei |
| Finish (capture) | Fertig | |
| Locate… | Speicherort angeben… | |

### Español (`es`)

| English | Español | Notas |
|---|---|---|
| note | nota | plural: notas; estado: abierta / resuelta |
| overall comment | comentario general | etiqueta corta: General |
| timestamped comment | comentario con marca de tiempo | etiqueta corta: Marca de tiempo; solo video |
| folder comment | comentario de carpeta | marcador para IA: «Carpeta completa» |
| annotate / Annotations | anotar / Anotaciones | menú: Anotar |
| notes file / notes folder | archivo de notas / carpeta de notas | `.sniptoss` sin traducir |
| notes panel | panel de notas | |
| library | biblioteca | |
| item | elemento | nunca «material» |
| project / folder | proyecto / carpeta | |
| canvas | lienzo | «frame» en texto para IA: «imagen» |
| mark | marca | Pin = «Punto»; Pen = «Bolígrafo» |
| pin to top / unpin | anclar arriba / desanclar | |
| open / resolved | abierta / resuelta | |
| done / won't fix | hecha / descartada | Marcar como hecha / descartada; Reabrir |
| check / uncheck | marcar / desmarcar | casilla; «notas marcadas» |
| select | seleccionar | resaltar una nota |
| snapshot / screenshot | instantánea / captura de pantalla | conceptos distintos |
| Screen Capture / Capture | Captura de pantalla / Capturar | menú: Capturar pantalla… |
| Copy as Text / Images | Copiar como texto / imágenes | |
| web-based AI / chat app | IA web / aplicación de chat | sin nombres de producto |
| shortcut | método abreviado (de teclado) | acceso directo solo para el del escritorio |
| tray | área de notificación | |
| clipboard / File Explorer | Portapapeles / Explorador de archivos | |
| Settings | Configuración | |
| log / diagnostic info | registro / información de diagnóstico | |
| remove / delete | quitar / eliminar | quitar = de la lista; eliminar = notas |
| reload / refresh | volver a cargar / actualizar | |
| locate | localizar | |
| OK | Aceptar | |
| Finish | Finalizar | |
| Shift / Enter / Delete / Backspace / Space / Wheel | Mayús / Entrar / Supr / Retroceso / Espacio / Rueda | Ctrl, Alt, Esc, Tab, Win sin cambio |
| video time / range | tiempo del video / intervalo | «video» sin tilde |

### Italiano (`it`)

| English | Italian | Notes |
|---|---|---|
| note | nota / note | Always feminine; "Annotations" (section) = Annotazioni; menu "Annotate" = Annota |
| item | elemento / elementi | One file being annotated |
| library (left panel / list) | raccolta; "list" = elenco | "Clear Library" = Svuota raccolta; "Remove from the list" = Rimuovi dall'elenco |
| notes panel | riquadro delle note | Windows-style "riquadro" for pane |
| canvas | area di disegno | |
| overall comment | commento generale | Short form: Generale |
| timestamped comment | commento con marca temporale | Short form: Marca temporale; video only |
| folder comment | commento sulla cartella | AI marker "Whole folder" = Intera cartella |
| open / resolved | aperta / risolta | Resolved = fatta + da non modificare |
| done / won't fix | fatta / da non modificare | Command: Segna come fatta / Segna come da non modificare |
| reopen | riapri | |
| check / uncheck (checkbox) | spunta / rimuovi spunta | Distinct from select = seleziona |
| mark (drawn shape) | segno | Freehand = segno a mano libera |
| pin (tool) | puntina | List action "Pin to Top" = Fissa in alto; Unpin = Non fissare più |
| snapshot (per note) | istantanea | |
| screenshot | screenshot | Feature "Screen Capture" = Acquisizione schermo; button Capture = Acquisisci |
| frame (AI position text) | immagine | e.g. "in alto a sinistra nell'immagine" |
| tray | area di notifica | |
| clipboard | Appunti | "negli Appunti" |
| File Explorer | Esplora file | |
| shortcut (keyboard) | tasto di scelta rapida | Dialog: Tasti di scelta rapida |
| AI | IA | agents = agenti IA; web-based AI = IA sul web; chat app = app di chat |
| Locate… | Individua… | |
| Copy as Text / Images | Copia come testo / immagini | |
| Keys | Maiusc, Invio, Canc, Spazio, Rotellina, Fine | Ctrl, Alt, Win, Esc, Tab, Backspace, Home unchanged |

### Português (Brasil) (`pt-BR`)

| English | Portuguese (Brazil) | Notes |
|---|---|---|
| note (one annotation) | nota | Annotations / Anotações only as a section title; verb: anotar |
| notes file | arquivo de notas | |
| notes panel | painel de notas | |
| library | biblioteca | left panel |
| item | item | |
| project / folder | projeto / pasta | |
| canvas | área de visualização | not "tela" (tela = screen) |
| overall comment | comentário geral | short form: Geral |
| timestamped comment | comentário com marcação de tempo | short form: Marcação de tempo; só vídeo |
| folder comment | comentário da pasta | marker text: Pasta inteira |
| open (note) | em aberto | notas em aberto; Reopen = Reabrir |
| resolved | resolvida | done = Concluída; won't fix = Não corrigir |
| check / uncheck (checkbox) | marcar / desmarcar | checked notes = notas marcadas |
| mark (drawn shape) | marcação | |
| Pin (tool) / Pin to Top | Alfinete / Fixar no topo | Unpin = Desafixar |
| snapshot (per-note image) | instantâneo | |
| screenshot / Screen Capture | captura de tela | button: Capturar; end of capture: Finalizar |
| Copy as Text / as Images | Copiar como texto / como imagens | |
| web-based AI / chat apps | IA na web / aplicativos de chat | AI agents = agentes de IA |
| File Explorer | Explorador de Arquivos | |
| tray | área de notificação | |
| Settings / shortcut | Configurações / atalho | Keyboard Shortcuts = Atalhos de teclado |
| clipboard | Área de Transferência | |
| Remove (list) / Delete (notes) | Remover / Excluir | |
| Locate… (re-link item) | Indicar local… | Find = Localizar |
| Full Screen / Always on Top | Tela inteira / Sempre no topo | |
| Space / Wheel | Espaço / Roda | other key names unchanged |

### Русский (`ru`)

| English | Русский | Примечание |
|---|---|---|
| note | заметка | один отдельный комментарий с меткой |
| Annotations (menu / page title) | Заметки | меню, страница параметров, группа сочетаний |
| notes file / notes folder / notes panel | файл заметок / папка заметок / панель заметок | |
| item | элемент | один файл, к которому добавляют заметки |
| library | библиотека | левая панель |
| project / folder | проект / папка | |
| canvas | холст | область просмотра элемента |
| mark | метка | любая нарисованная фигура |
| Pin (tool) / Point (AI text) | Булавка / Точка | «Закрепить вверху» / «Открепить» — для списка |
| Hand / Select / Pen | Рука / Выбор / Перо | инструменты |
| overall comment | общий комментарий | кратко «Общий» |
| timestamped comment | комментарий к моменту | кратко «Момент»; только видео |
| folder comment | комментарий к папке | маркер в тексте для ИИ: «Вся папка» |
| open / resolved | открытая / решённая | resolved = выполнено + не исправлять |
| Done / Won't fix | Выполнено / Не исправлять | команды: «Пометить как выполненную», «Пометить как «не исправлять»», «Открыть снова» |
| check (checkbox) | отметить | «отмеченные заметки»; select = выбрать / выбранный |
| snapshot (per note) | снимок | «снимок заметки» |
| screenshot / Screen Capture / Capture | снимок экрана / Захват экрана / Захват | |
| Copy as Text / Copy as Images | Копировать как текст / Копировать как изображения | |
| web-based AI / chat app / AI agent | веб-сервис ИИ / мессенджер / ИИ-агент | без названий продуктов |
| Settings | Параметры | страницы: Общие, Заметки, Копирование, Система, Сочетания клавиш, Дополнительно, О программе |
| File Explorer / tray / clipboard | Проводник / область уведомлений / буфер обмена | |
| shortcut | сочетание клавиш | |
| log / diagnostic info | журнал / диагностические сведения | |
| Remove (from list) / Delete (notes) | Убрать из списка / Удалить | |
| Locate… | Указать расположение… | |
| Finish (capture) | Завершить | |
| range / Video time | интервал / Время в видео | |

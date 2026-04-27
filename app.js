/* ============================================================
   FRe:x Schedule - アプリケーションロジック
   サイボウズOffice風グループスケジュール管理ツール
   ============================================================ */

'use strict';

// ----------------------------------------
// 定数・設定
// ----------------------------------------

/** 予定タイプ定義（サイボウズ準拠の色分け） */
const EVENT_TYPES = {
  'telework':      { label: 'テレワーク',  color: '#4CAF50', bg: '#E8F5E9', icon: '🏠' },
  'tele-half':     { label: 'テレハーフ',  color: '#2196F3', bg: '#E3F2FD', icon: '💻' },
  'meeting':       { label: '会議',        color: '#1565C0', bg: '#BBDEFB', icon: '👥' },
  'visitor':       { label: '来客',        color: '#0277BD', bg: '#E1F5FE', icon: '🤝' },
  'out':           { label: '外出',        color: '#FF9800', bg: '#FFF3E0', icon: '🚗' },
  'business-trip': { label: '出張',        color: '#9C27B0', bg: '#F3E5F5', icon: '✈️' },
  'holiday':       { label: '休み',        color: '#F44336', bg: '#FFEBEE', icon: '🌴' },
  'other':         { label: 'その他',      color: '#607D8B', bg: '#ECEFF1', icon: '📝' },
};

/** 優先度ラベル */
const PRIORITY_LABELS = { 1: '高', 2: '中', 3: '低' };

/** 日本語曜日 */
const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 日本の祝日を計算して返す（振替休日含む）
 * @param {number} year
 * @returns {Object} { 'YYYY-MM-DD': '祝日名', ... }
 */
function getJapaneseHolidays(year) {
  const holidays = {};

  // ローカル時刻でDateを生成するヘルパー
  const localDate = (y, m, d) => new Date(y, m - 1, d);
  const dateKey = (y, m, d) => {
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  };
  const add = (month, day, name) => {
    holidays[dateKey(year, month, day)] = name;
  };
  // キーからローカルDateを取得（UTC誤差を回避）
  const keyToDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return localDate(y, m, d);
  };

  // ハッピーマンデー計算（第N月曜日）
  const nthMonday = (month, n) => {
    const d = localDate(year, month, 1);
    const first = d.getDay(); // 0=日
    const offset = (1 - first + 7) % 7; // 最初の月曜日のオフセット
    return 1 + offset + (n - 1) * 7;
  };

  // 春分・秋分（1980〜2099年対応の簡易計算式）
  const y = year - 1980;
  const shunbun = Math.floor(20.8431 + 0.242194 * y - Math.floor(y / 4));
  const shubun  = Math.floor(23.2488 + 0.242194 * y - Math.floor(y / 4));

  // ── 固定祝日 ──
  add(1,  1,  '元日');
  add(2,  11, '建国記念の日');
  add(2,  23, '天皇誕生日');
  add(3,  shunbun, '春分の日');
  add(4,  29, '昭和の日');
  add(5,  3,  '憲法記念日');
  add(5,  4,  'みどりの日');
  add(5,  5,  'こどもの日');
  add(7,  nthMonday(7, 3),  '海の日');
  add(8,  11, '山の日');
  add(9,  nthMonday(9, 3),  '敬老の日');
  add(9,  shubun,  '秋分の日');
  add(10, nthMonday(10, 2), 'スポーツの日');
  add(11, 3,  '文化の日');
  add(11, 23, '勤労感謝の日');

  // ── ハッピーマンデー ──
  add(1, nthMonday(1, 2), '成人の日');

  // ── 国民の休日（祝日に挟まれた平日）──
  // まず固定祝日+ハッピーマンデーで判定
  const baseKeys = Object.keys(holidays).sort();
  baseKeys.forEach(key => {
    const d = keyToDate(key);
    const prev = new Date(d); prev.setDate(prev.getDate() - 2);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-${String(prev.getDate()).padStart(2,'0')}`;
    const mid = new Date(d); mid.setDate(mid.getDate() - 1);
    const midKey = `${mid.getFullYear()}-${String(mid.getMonth()+1).padStart(2,'0')}-${String(mid.getDate()).padStart(2,'0')}`;
    if (holidays[prevKey] && !holidays[midKey] && mid.getDay() !== 0 && mid.getDay() !== 6) {
      holidays[midKey] = '国民の休日';
    }
  });

  // ── 振替休日（祝日が日曜→翌月曜、連続する場合は順にずらす）──
  const allSorted = Object.keys(holidays).sort();
  allSorted.forEach(key => {
    const d = keyToDate(key);
    if (d.getDay() === 0) { // 日曜祝日
      // 翌日から順に、祝日でも日曜でもない日を探す
      let candidate = new Date(d);
      candidate.setDate(candidate.getDate() + 1);
      while (true) {
        const cKey = `${candidate.getFullYear()}-${String(candidate.getMonth()+1).padStart(2,'0')}-${String(candidate.getDate()).padStart(2,'0')}`;
        if (!holidays[cKey] && candidate.getDay() !== 0) {
          holidays[cKey] = '振替休日';
          break;
        }
        candidate.setDate(candidate.getDate() + 1);
        if (candidate.getDate() > 31) break; // 無限ループ防止
      }
    }
  });

  return holidays;
}

/** 祝日キャッシュ */
const holidayCache = {};

/** アバターカラーパレット */
const AVATAR_COLORS = [
  '#4A90E2', '#E74C3C', '#2ECC71', '#F39C12', '#9B59B6',
  '#1ABC9C', '#E67E22', '#3498DB', '#E91E63', '#00BCD4',
  '#FF5722', '#795548',
];

// ----------------------------------------
// グローバル状態
// ----------------------------------------
let supabaseClient = null;        // Supabase クライアント
let currentUser = null;           // ログイン中ユーザー（auth.users）
let currentProfile = null;        // プロフィール（profiles テーブル）
let allProfiles = [];             // 全ユーザープロフィール
let allEvents = [];               // 取得済みイベント一覧
let allFacilities = [];           // 施設一覧
let todos = [];                   // TODO一覧
let currentView = 'group-week';   // 現在のビュー
let currentPage = 'schedule';     // 現在のページ（schedule / todo）
let currentDate = new Date();     // 現在参照中の日付
let miniCalDate = new Date();     // ミニカレンダーの月
let realtimeChannel = null;       // リアルタイム購読チャンネル
let isAppReady = false;           // 初期化完了フラグ（二重起動防止）
let editingEventId = null;        // 編集中イベントID（nullで新規）

// ----------------------------------------
// 初期化
// ----------------------------------------

/**
 * 時刻セレクトの初期化（5分刻み）
 */
function initTimePickers() {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      opts.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  const html = opts.map(t => `<option value="${t}">${t}</option>`).join('');
  ['event-start-time', 'event-end-time'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = html;
  });
  document.getElementById('event-start-time').addEventListener('change', autoFillEndTime);
}

function tpSetValue(id, timeStr) {
  const sel = document.getElementById(id);
  if (!sel) return;
  // 5分刻みにスナップして選択
  const [hv, mv] = (timeStr || '09:00').split(':').map(Number);
  const mSnapped = Math.min(55, Math.round(mv / 5) * 5);
  sel.value = `${String(hv).padStart(2,'0')}:${String(mSnapped).padStart(2,'0')}`;
}

function autoFillEndTime() {
  const val = document.getElementById('event-start-time').value;
  if (!val) return;
  const [h, m] = val.split(':').map(Number);
  let endH = h + 1;
  if (endH >= 24) endH = 23;
  tpSetValue('event-end-time', `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
}

/**
 * アプリ起動処理
 */
async function init() {
  showLoading(true);
  try {
    // Supabase クライアント初期化
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 認証状態を確認
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      currentUser = session.user;
      await onSignedIn();
    } else {
      showAuthScreen();
    }

    // 認証状態の変化を監視
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        await onSignedIn();
      } else if (event === 'SIGNED_OUT') {
        onSignedOut();
      }
    });
  } catch (err) {
    console.error('初期化エラー:', err);
    showToast('初期化に失敗しました。ページを再読み込みしてください。', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * サインイン後の処理
 */
async function onSignedIn() {
  if (isAppReady) return; // タブ復帰時のトークン更新など二重呼び出しを防ぐ
  isAppReady = true;
  showLoading(true);
  try {
    // カレンダー表示に必要なデータを優先取得
    const [start, end] = getDateRange();
    await Promise.all([
      fetchOrCreateProfile(),
      fetchAllProfiles(),
      fetchEvents(start, end),
    ]);
    // 画面をすぐに表示
    showAppScreen();
    renderCurrentView();
    showLoading(false);

    // 施設・TODOはバックグラウンドで取得（初期表示に不要）
    Promise.all([
      fetchFacilities(),
      fetchTodos(),
    ]).catch(err => console.error('バックグラウンドデータ取得エラー:', err));

    // リアルタイム購読を開始
    subscribeRealtime();
  } catch (err) {
    console.error('サインイン後の処理エラー:', err);
    showToast('データの読み込みに失敗しました。', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * サインアウト後の処理
 */
function onSignedOut() {
  isAppReady = false;
  currentUser = null;
  currentProfile = null;
  allProfiles = [];
  allEvents = [];
  todos = [];
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  showAuthScreen();
}

// ----------------------------------------
// 認証
// ----------------------------------------

/**
 * ログイン処理
 */
async function signIn(email, password) {
  showLoading(true);
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showToast('ログインしました', 'success');
  } catch (err) {
    showToast(getAuthErrorMessage(err), 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * パスワードリセットメール送信
 */
async function sendPasswordReset(email) {
  showLoading(true);
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://frex-design.github.io/schedule-calendar/'
    });
    if (error) throw error;
    showToast('パスワード再設定メールを送信しました。メールをご確認ください。', 'success');
    // ログインフォームに戻す
    document.getElementById('reset-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('reset-email').value = '';
  } catch (err) {
    showToast('メール送信に失敗しました。メールアドレスをご確認ください。', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * サインアップ処理
 */
async function signUp(name, email, password, department) {
  // ドメイン制限チェック
  if (ALLOWED_DOMAIN && !email.endsWith('@' + ALLOWED_DOMAIN)) {
    showToast(`メールアドレスは @${ALLOWED_DOMAIN} のドメインのみ使用できます`, 'error');
    return;
  }
  showLoading(true);
  try {
    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          department,
          avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        }
      }
    });
    if (error) throw error;
    showToast('確認メールを送信しました。メールをご確認ください。', 'info');
  } catch (err) {
    showToast(getAuthErrorMessage(err), 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * ログアウト処理
 */
async function signOut() {
  await supabaseClient.auth.signOut();
  showToast('ログアウトしました', 'info');
}

/**
 * 認証エラーメッセージの日本語化
 */
function getAuthErrorMessage(err) {
  const msg = err.message || '';
  if (msg.includes('Invalid login credentials')) return 'メールアドレスまたはパスワードが間違っています';
  if (msg.includes('Email not confirmed')) return 'メールアドレスを確認してください';
  if (msg.includes('User already registered')) return 'このメールアドレスは既に登録されています';
  if (msg.includes('Password should be at least')) return 'パスワードは6文字以上にしてください';
  return err.message || 'エラーが発生しました';
}

// ----------------------------------------
// データ取得・操作
// ----------------------------------------

/**
 * 自分のプロフィールを取得、なければ作成
 */
async function fetchOrCreateProfile() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (error && error.code === 'PGRST116') {
    // レコードが存在しない場合は作成
    const name = currentUser.user_metadata?.name || currentUser.email.split('@')[0];
    const { data: created, error: createErr } = await supabaseClient
      .from('profiles')
      .insert({
        id: currentUser.id,
        name,
        email: currentUser.email,
        department: currentUser.user_metadata?.department || '',
        avatar_color: currentUser.user_metadata?.avatar_color || '#4A90E2',
      })
      .select()
      .single();
    if (createErr) throw createErr;
    currentProfile = created;
  } else if (error) {
    throw error;
  } else {
    currentProfile = data;
  }
}

/**
 * 全ユーザープロフィールを取得
 */
async function fetchAllProfiles() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*');
  if (error) throw error;
  allProfiles = sortProfiles(data || []);
  updateHeaderUser();
}

/**
 * プロフィールを「自分が最上位、他はあいうえお順」でソート
 */
function sortProfiles(profiles) {
  return [...profiles].sort((a, b) => {
    const aIsMe = a.id === currentUser?.id;
    const bIsMe = b.id === currentUser?.id;
    if (aIsMe && !bIsMe) return -1;
    if (!aIsMe && bIsMe) return 1;
    return (a.name || '').localeCompare(b.name || '', 'ja', { sensitivity: 'base' });
  });
}

/**
 * 施設一覧を取得
 */
async function fetchFacilities() {
  const { data, error } = await supabaseClient
    .from('facilities')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  allFacilities = data || [];
}

/**
 * 指定期間のイベントを取得
 */
async function fetchEvents(startDate, endDate) {
  const start = toISO(startOf(startDate));
  const end = toISO(endOf(endDate));
  const { data, error } = await supabaseClient
    .from('events')
    .select(`*, profiles!events_user_id_fkey(id, name, avatar_color, department),
             event_participants(user_id, profiles!event_participants_user_id_fkey(id, name, avatar_color))`)
    .gte('start_datetime', start)
    .lte('end_datetime', end)
    .order('start_datetime');
  if (error) throw error;
  allEvents = data || [];
}

/**
 * イベントを保存（新規 or 更新）
 */
async function saveEvent(eventData) {
  showLoading(true);
  try {
    const participants = eventData.participants || [];
    delete eventData.participants;

    let eventId;
    if (editingEventId) {
      // 更新
      const { data, error } = await supabaseClient
        .from('events')
        .update({ ...eventData, updated_at: new Date().toISOString() })
        .eq('id', editingEventId)
        .eq('user_id', currentUser.id)
        .select()
        .single();
      if (error) throw error;
      eventId = data.id;
    } else {
      // 新規作成
      const dates = eventData.dates; // 複数日指定の場合のみ存在
      delete eventData.dates;

      let insertData;
      if (dates && dates.length > 0) {
        // 複数日モード
        insertData = dates.map(date => ({
          ...eventData,
          start_datetime: date.start,
          end_datetime: date.end,
          user_id: currentUser.id,
        }));
      } else {
        // 単一日モード（start_datetime / end_datetime はそのまま使う）
        insertData = [{ ...eventData, user_id: currentUser.id }];
      }

      const { data, error } = await supabaseClient
        .from('events')
        .insert(insertData)
        .select();
      if (error) throw error;
      eventId = data[0]?.id;
      // 複数日の場合、参加者は最初のイベントのみ
      if (data.length > 1) {
        showToast(`${data.length}件の予定を登録しました`, 'success');
        await refreshCurrentView();
        return;
      }
    }

    // 参加者を更新
    if (eventId && participants.length > 0) {
      // 既存の参加者を削除してから再追加
      await supabaseClient.from('event_participants').delete().eq('event_id', eventId);
      const partInsert = participants.map(uid => ({ event_id: eventId, user_id: uid }));
      await supabaseClient.from('event_participants').insert(partInsert);
    } else if (eventId && editingEventId) {
      await supabaseClient.from('event_participants').delete().eq('event_id', eventId);
    }

    showToast(editingEventId ? '予定を更新しました' : '予定を登録しました', 'success');
    // 全件再取得の代わりに保存した1件だけ取得してローカル更新
    const { data: savedEvent } = await supabaseClient
      .from('events')
      .select(`*, profiles!events_user_id_fkey(id, name, avatar_color, department),
               event_participants(user_id, profiles!event_participants_user_id_fkey(id, name, avatar_color))`)
      .eq('id', eventId)
      .single();
    if (savedEvent) {
      if (editingEventId) {
        const idx = allEvents.findIndex(e => e.id === editingEventId);
        if (idx >= 0) allEvents[idx] = savedEvent;
      } else {
        allEvents.push(savedEvent);
        allEvents.sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
      }
    }
    renderCurrentView();
  } catch (err) {
    console.error('イベント保存エラー:', err);
    showToast('予定の保存に失敗しました: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * イベントを削除
 */
async function deleteEvent(eventId) {
  if (!confirm('この予定を削除しますか？')) return;
  showLoading(true);
  try {
    const { error } = await supabaseClient
      .from('events')
      .delete()
      .eq('id', eventId)
      .eq('user_id', currentUser.id);
    if (error) throw error;
    showToast('予定を削除しました', 'success');
    closeModal('event-detail-modal');
    await refreshCurrentView();
  } catch (err) {
    showToast('削除に失敗しました: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * 指定日のメモを取得
 */
async function fetchDayMemo(dateStr) {
  const { data } = await supabaseClient
    .from('day_memos')
    .select('content')
    .eq('user_id', currentUser.id)
    .eq('memo_date', dateStr)
    .maybeSingle();
  return data?.content || '';
}

/**
 * 指定日のメモを保存（upsert）
 */
async function saveDayMemo(dateStr, content) {
  const { error } = await supabaseClient
    .from('day_memos')
    .upsert(
      { user_id: currentUser.id, memo_date: dateStr, content },
      { onConflict: 'user_id,memo_date' }
    );
  if (error) throw error;
}

/**
 * TODOを取得
 */
async function fetchTodos() {
  const { data, error } = await supabaseClient
    .from('todos')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  todos = data || [];
  renderTodos();
}

/**
 * TODOを追加
 */
async function addTodo(title, dueDate, priority) {
  try {
    const { error } = await supabaseClient.from('todos').insert({
      user_id: currentUser.id,
      title,
      due_date: dueDate || null,
      priority: parseInt(priority),
      sort_order: todos.length,
    });
    if (error) throw error;
    showToast('TODOを追加しました', 'success');
    await fetchTodos();
  } catch (err) {
    showToast('TODOの追加に失敗しました', 'error');
  }
}

/**
 * TODOの完了状態を切り替え
 */
async function toggleTodo(id, completed) {
  try {
    const { error } = await supabaseClient
      .from('todos')
      .update({ completed })
      .eq('id', id)
      .eq('user_id', currentUser.id);
    if (error) throw error;
    todos = todos.map(t => t.id === id ? { ...t, completed } : t);
    renderTodos();
  } catch (err) {
    showToast('更新に失敗しました', 'error');
  }
}

/**
 * TODOを削除
 */
async function deleteTodo(id) {
  try {
    const { error } = await supabaseClient
      .from('todos')
      .delete()
      .eq('id', id)
      .eq('user_id', currentUser.id);
    if (error) throw error;
    todos = todos.filter(t => t.id !== id);
    renderTodos();
    showToast('TODOを削除しました', 'info');
  } catch (err) {
    showToast('削除に失敗しました', 'error');
  }
}

/**
 * プロフィールを更新
 */
async function updateProfile(updates) {
  showLoading(true);
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .update(updates)
      .eq('id', currentUser.id)
      .select()
      .single();
    if (error) throw error;
    currentProfile = data;
    allProfiles = sortProfiles(allProfiles.map(p => p.id === currentUser.id ? data : p));
    updateHeaderUser();
    showToast('プロフィールを更新しました', 'success');
    closeModal('profile-modal');
    renderCurrentView();
  } catch (err) {
    showToast('更新に失敗しました: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * メール・パスワードを更新（Supabase Auth）
 */
async function updateAuthCredentials(newEmail, newPassword) {
  const updates = {};
  if (newEmail && newEmail !== currentUser.email) updates.email = newEmail;
  if (newPassword && newPassword.length >= 6) updates.password = newPassword;
  if (Object.keys(updates).length === 0) return true;

  const { error } = await supabaseClient.auth.updateUser(updates);
  if (error) throw error;
  if (updates.email) {
    showToast(`メールアドレスを ${updates.email} に変更しました`, 'success');
  }
  if (updates.password) {
    showToast('パスワードを変更しました', 'success');
  }
  return true;
}

// ----------------------------------------
// リアルタイム購読
// ----------------------------------------

/**
 * Supabase Realtime でイベント変更を購読
 */
function subscribeRealtime() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }
  realtimeChannel = supabaseClient
    .channel('schedule-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, async (payload) => {
      console.log('リアルタイム更新:', payload);
      await refreshCurrentView();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async () => {
      await fetchAllProfiles();
      renderCurrentView();
    })
    .subscribe();
}

// ----------------------------------------
// ビュー制御
// ----------------------------------------

/**
 * 現在のビューを再描画
 */
async function refreshCurrentView() {
  const [start, end] = getDateRange();
  await fetchEvents(start, end);
  renderCurrentView();
}

/**
 * 現在のビューに応じた日付範囲を取得
 */
function getDateRange() {
  switch (currentView) {
    case 'group-week':
    case 'personal-week':
      return getWeekRange(currentDate);
    case 'group-day':
    case 'personal-day':
      return [currentDate, currentDate];
    case 'personal-month':
      return getMonthRange(currentDate);
    default:
      return getWeekRange(currentDate);
  }
}

/**
 * 現在のビューを描画
 */
function renderCurrentView() {
  const content = document.getElementById('calendar-content');
  if (!content) return;

  content.innerHTML = '';
  content.classList.add('fade-in');
  setTimeout(() => content.classList.remove('fade-in'), 300);

  switch (currentView) {
    case 'group-week':
      renderGroupWeek(content);
      break;
    case 'group-day':
      renderGroupDay(content);
      break;
    case 'personal-day':
      renderPersonalDay(content);
      break;
    case 'personal-week':
      renderPersonalWeek(content);
      break;
    case 'personal-month':
      renderPersonalMonth(content);
      break;
  }

  updateNavPeriod();
}

/**
 * ナビゲーションの期間表示を更新
 */
function updateNavPeriod() {
  const el = document.getElementById('nav-period');
  if (!el) return;
  switch (currentView) {
    case 'group-week':
    case 'personal-week': {
      const [start, end] = getWeekRange(currentDate);
      el.textContent = `${formatDate(start, 'YYYY年M月D日')} 〜 ${formatDate(end, 'M月D日（${dow}）')}`;
      break;
    }
    case 'group-day':
    case 'personal-day':
      el.textContent = formatDate(currentDate, 'YYYY年M月D日（${dow}）');
      break;
    case 'personal-month':
      el.textContent = formatDate(currentDate, 'YYYY年M月');
      break;
  }
}

// ----------------------------------------
// グループ週ビュー
// ----------------------------------------

/**
 * グループ週ビューを描画
 */
function renderGroupWeek(container) {
  const [weekStart, weekEnd] = getWeekRange(currentDate);
  const days = getDaysInRange(weekStart, weekEnd);
  const today = toDateStr(new Date());

  const table = document.createElement('table');
  table.className = 'group-schedule-table';

  // 祝日データ取得
  const year = currentDate.getFullYear();
  if (!holidayCache[year]) holidayCache[year] = getJapaneseHolidays(year);
  // 週をまたぐ場合は翌年も取得
  const yearEnd = weekEnd.getFullYear();
  if (!holidayCache[yearEnd]) holidayCache[yearEnd] = getJapaneseHolidays(yearEnd);
  const holidays = { ...holidayCache[year], ...holidayCache[yearEnd] };

  // ヘッダー行
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th class="name-col">社員名</th>`;
  days.forEach(day => {
    const ds = toDateStr(day);
    const isToday = ds === today;
    const dow = DOW_JA[day.getDay()];
    const dayOfWeek = day.getDay(); // 0=日, 6=土
    const holidayName = holidays[ds];
    const isSat = dayOfWeek === 6;
    const isSun = dayOfWeek === 0;
    const isHoliday = !!holidayName;

    let thClass = '';
    if (isToday) thClass = 'today-col';
    else if (isSun || isHoliday) thClass = 'sunday-col';
    else if (isSat) thClass = 'saturday-col';

    headerRow.innerHTML += `
      <th class="${thClass}">
        <span class="col-date">${day.getDate()}</span>
        <span class="col-dow">${dow}</span>
        ${holidayName ? `<span class="col-holiday">${holidayName}</span>` : ''}
      </th>`;
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // データ行（全ユーザー）
  const tbody = document.createElement('tbody');
  allProfiles.forEach(profile => {
    const isMe = profile.id === currentUser.id;
    const tr = document.createElement('tr');
    if (isMe) tr.className = 'my-row';

    // 名前セル
    const nameTd = document.createElement('td');
    nameTd.className = 'name-cell';
    nameTd.innerHTML = `
      <div class="name-cell-inner">
        <div class="name-cell-info">
          <div class="name-cell-name">${escHtml(profile.name)}</div>
          <div class="name-cell-dept">${escHtml(profile.department || '')}</div>
        </div>
      </div>`;
    tr.appendChild(nameTd);

    // 各日付セル
    days.forEach(day => {
      const ds = toDateStr(day);
      const isToday = ds === today;
      const td = document.createElement('td');
      const eventsOnDay = getEventsOnDay(day, profile.id);
      const dayOfWeek = day.getDay();
      const isHoliday = !!holidays[ds];
      const isSat = dayOfWeek === 6;
      const isSun = dayOfWeek === 0;

      let cellExtra = '';
      if (!isToday) {
        if (isSun || isHoliday) cellExtra = 'sunday-cell';
        else if (isSat) cellExtra = 'saturday-cell';
      }

      td.innerHTML = `
        <div class="schedule-cell ${isToday ? 'today-col' : ''} ${cellExtra}" data-date="${ds}" data-uid="${profile.id}">
          ${eventsOnDay.map(ev => renderEventChip(ev)).join('')}
          ${isMe ? `<button class="cell-add-btn" onclick="openEventModal('${ds}')" title="予定を追加">+</button>` : ''}
        </div>`;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ----------------------------------------
// グループ日ビュー
// ----------------------------------------

/**
 * グループ日ビューを描画
 */
function renderGroupDay(container) {
  const today = toDateStr(new Date());
  const ds = toDateStr(currentDate);
  const dow = DOW_JA[currentDate.getDay()];

  const table = document.createElement('table');
  table.className = 'group-schedule-table';

  // ヘッダー行
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `
    <th class="name-col">社員名</th>
    <th class="${ds === today ? 'today-col' : ''}">
      <span class="col-date">${currentDate.getDate()}</span>
      <span class="col-dow">${dow}</span>
    </th>`;
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // データ行
  const tbody = document.createElement('tbody');
  allProfiles.forEach(profile => {
    const isMe = profile.id === currentUser.id;
    const tr = document.createElement('tr');
    if (isMe) tr.className = 'my-row';

    const nameTd = document.createElement('td');
    nameTd.className = 'name-cell';
    nameTd.innerHTML = `
      <div class="name-cell-inner">
        <div class="name-cell-info">
          <div class="name-cell-name">${escHtml(profile.name)}</div>
          <div class="name-cell-dept">${escHtml(profile.department || '')}</div>
        </div>
      </div>`;
    tr.appendChild(nameTd);

    const eventsOnDay = getEventsOnDay(currentDate, profile.id);
    const td = document.createElement('td');
    td.innerHTML = `
      <div class="schedule-cell ${ds === today ? 'today-col' : ''}" style="min-height:80px;">
        ${eventsOnDay.map(ev => renderEventChip(ev)).join('')}
        ${isMe ? `<button class="cell-add-btn" onclick="openEventModal('${ds}')" title="予定を追加">+</button>` : ''}
      </div>`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ----------------------------------------
// 個人日ビュー
// ----------------------------------------

/**
 * 個人日ビューを描画
 */
function renderPersonalDay(container) {
  const ds = toDateStr(currentDate);
  const dow = DOW_JA[currentDate.getDay()];
  const eventsOnDay = getEventsOnDay(currentDate, currentUser.id).sort(
    (a, b) => new Date(a.start_datetime) - new Date(b.start_datetime)
  );

  const div = document.createElement('div');
  div.className = 'personal-day-view';
  div.innerHTML = `
    <div class="day-view-date">${formatDate(currentDate, 'YYYY年M月D日')}（${dow}）</div>
    <div class="day-event-list">
      ${eventsOnDay.length === 0 ? `
        <div class="empty-day">
          <div class="empty-icon">📅</div>
          <div>この日の予定はありません</div>
          <button class="btn btn-primary" style="margin-top:16px;" onclick="openEventModal('${ds}')">
            ＋ 予定を追加
          </button>
        </div>` :
        eventsOnDay.map(ev => renderDayEventCard(ev)).join('')
      }
    </div>
    <div class="day-memo-section">
      <div class="day-memo-header">
        <span class="day-memo-label">メモ</span>
        <span class="day-memo-status" id="day-memo-status"></span>
      </div>
      <textarea class="day-memo-textarea" id="day-memo-textarea"
        placeholder="この日のメモを自由に入力できます..."></textarea>
    </div>`;
  container.appendChild(div);

  // メモを非同期で読み込んでセット
  const textarea = div.querySelector('#day-memo-textarea');
  const statusEl = div.querySelector('#day-memo-status');
  let debounceTimer = null;

  fetchDayMemo(ds).then(content => {
    textarea.value = content;
  });

  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    statusEl.textContent = '保存中...';
    statusEl.className = 'day-memo-status saving';
    debounceTimer = setTimeout(async () => {
      try {
        await saveDayMemo(ds, textarea.value);
        statusEl.textContent = '保存済み ✓';
        statusEl.className = 'day-memo-status saved';
        setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'day-memo-status'; }, 2000);
      } catch (e) {
        statusEl.textContent = '保存失敗';
        statusEl.className = 'day-memo-status error';
      }
    }, 1000);
  });
}

/**
 * 日ビューのイベントカードHTMLを生成
 */
function renderDayEventCard(ev) {
  const type = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
  const timeStr = ev.is_all_day ? '終日' : `${formatTime(ev.start_datetime)} 〜 ${formatTime(ev.end_datetime)}`;
  return `
    <div class="day-event-card" style="border-left-color:${type.color};" onclick="openEventDetail('${ev.id}')">
      <div class="day-event-time">${type.icon} ${timeStr}${ev.is_private ? ' <span class="private-badge">🔒</span>' : ''}</div>
      <div class="day-event-body">
        <div class="day-event-title">${escHtml(ev.title)}</div>
        <div class="day-event-meta">
          <span style="color:${type.color};font-weight:600;">${type.label}</span>
          ${ev.facility ? `<span>📍 ${escHtml(ev.facility)}</span>` : ''}
          ${ev.memo ? `<span>📝 ${escHtml(ev.memo.substring(0, 40))}${ev.memo.length > 40 ? '...' : ''}</span>` : ''}
        </div>
      </div>
    </div>`;
}

// ----------------------------------------
// 個人週ビュー
// ----------------------------------------

/**
 * 個人週ビューを描画
 */
function renderPersonalWeek(container) {
  const [weekStart, weekEnd] = getWeekRange(currentDate);
  const days = getDaysInRange(weekStart, weekEnd);
  const today = toDateStr(new Date());

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'overflow-x:auto;';

  const table = document.createElement('table');
  table.className = 'personal-week-table';
  table.style.minWidth = '700px';

  // ヘッダー
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th class="time-col">時刻</th>`;
  days.forEach(day => {
    const isToday = toDateStr(day) === today;
    const dow = DOW_JA[day.getDay()];
    headerRow.innerHTML += `<th style="${isToday ? 'background:#00a9e0;color:#fff;' : ''}">${day.getDate()}日(${dow})</th>`;
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // 終日イベント行
  const allDayRow = document.createElement('tr');
  allDayRow.innerHTML = `<td class="time-cell" style="font-size:10px;">終日</td>`;
  days.forEach(day => {
    const allDayEvents = getEventsOnDay(day, currentUser.id).filter(e => e.is_all_day);
    const ds = toDateStr(day);
    allDayRow.innerHTML += `
      <td style="padding:4px;">
        ${allDayEvents.map(ev => renderEventChip(ev)).join('')}
      </td>`;
  });
  table.appendChild(allDayRow);

  // 時間行（6時〜22時）
  const tbody = document.createElement('tbody');
  for (let h = 6; h <= 22; h++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="time-cell">${h}:00</td>`;
    days.forEach(day => {
      const ds = toDateStr(day);
      const isToday = ds === today;
      const eventsInHour = getEventsInHour(day, h, currentUser.id);
      tr.innerHTML += `
        <td>
          <div class="day-cell ${isToday ? 'today-cell' : ''}" onclick="openEventModal('${ds}')"
               data-date="${ds}" data-hour="${h}">
            ${eventsInHour.map(ev => `
              <div class="event-chip" style="background:${EVENT_TYPES[ev.type]?.bg};color:${EVENT_TYPES[ev.type]?.color};border-left-color:${EVENT_TYPES[ev.type]?.color};"
                   onclick="event.stopPropagation();openEventDetail('${ev.id}')">
                <span class="event-chip-title">${escHtml(ev.title)}</span>
              </div>`).join('')}
          </div>
        </td>`;
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

// ----------------------------------------
// 個人月ビュー
// ----------------------------------------

/**
 * 個人月ビューを描画
 */
function renderPersonalMonth(container) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = toDateStr(new Date());

  // グリッド開始日（月曜始まり）
  let startDow = firstDay.getDay(); // 0=日
  // 月曜始まりに変換（0=月〜6=日）
  startDow = (startDow + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - startDow);

  const div = document.createElement('div');
  div.className = 'month-view';

  // 曜日ヘッダー
  const dowHeaders = ['月', '火', '水', '木', '金', '土', '日'];
  let gridHTML = '<div class="month-grid">';
  dowHeaders.forEach((d, i) => {
    const cls = i === 6 ? 'sun' : i === 5 ? 'sat' : '';
    gridHTML += `<div class="month-dow-header ${cls}">${d}</div>`;
  });

  // 6週分描画
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(cursor);
      const ds = toDateStr(day);
      const isThisMonth = day.getMonth() === month;
      const isToday = ds === today;
      const dow = day.getDay(); // 0=日
      const eventsOnDay = isThisMonth ? getEventsOnDay(day, currentUser.id, true) : [];

      // 祝日チェック
      if (!holidayCache[day.getFullYear()]) holidayCache[day.getFullYear()] = getJapaneseHolidays(day.getFullYear());
      const holidayName = holidayCache[day.getFullYear()][ds];
      const isHoliday = !!holidayName;

      let cellClass = 'month-day-cell';
      if (!isThisMonth) cellClass += ' other-month';
      if (isToday) cellClass += ' today';
      // 月曜始まりなので d=5→土, d=6→日
      if (d === 5) cellClass += ' saturday';
      if (d === 6 || isHoliday) cellClass += ' sunday';

      const MAX_EVENTS = 3;
      const visibleEvents = eventsOnDay.slice(0, MAX_EVENTS);
      const moreCount = eventsOnDay.length - MAX_EVENTS;

      gridHTML += `
        <div class="${cellClass}" onclick="openEventModal('${ds}')">
          <div class="month-day-number">${day.getDate()}</div>
          ${holidayName ? `<div class="month-holiday-name">${holidayName}</div>` : ''}
          ${visibleEvents.map(ev => {
            const type = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
            return `<div class="month-event-chip" style="background:${type.bg};color:${type.color};border-left-color:${type.color};"
                         onclick="event.stopPropagation();openEventDetail('${ev.id}')">${escHtml(ev.title)}</div>`;
          }).join('')}
          ${moreCount > 0 ? `<div class="month-more">他${moreCount}件</div>` : ''}
        </div>`;

      cursor.setDate(cursor.getDate() + 1);
    }
  }
  gridHTML += '</div>';
  div.innerHTML = gridHTML;
  container.appendChild(div);
}

// ----------------------------------------
// イベントチップ描画
// ----------------------------------------

/**
 * イベントチップのHTMLを生成
 */
function renderEventChip(ev) {
  const type = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
  const timeStr = ev.is_all_day ? '' : formatTime(ev.start_datetime);
  return `
    <div class="event-chip" style="background:${type.bg};color:${type.color};border-left-color:${type.color};"
         onclick="event.stopPropagation();openEventDetail('${ev.id}')" title="${escHtml(ev.title)}">
      <span>${type.icon}</span>
      <span class="event-chip-title">${timeStr ? timeStr + ' ' : ''}${escHtml(ev.title)}</span>
      ${ev.is_private ? '<span class="private-badge">🔒</span>' : ''}
    </div>`;
}

// ----------------------------------------
// TODO 描画
// ----------------------------------------

/**
 * TODOリストを描画
 */
function renderTodos() {
  const container = document.getElementById('todo-list-container');
  if (!container) return;

  const active = todos.filter(t => !t.completed);
  const completed = todos.filter(t => t.completed);
  const today = new Date().toISOString().split('T')[0];

  let html = '';

  if (active.length === 0 && completed.length === 0) {
    html = `<div class="empty-day"><div class="empty-icon">✅</div><div>TODOはありません</div></div>`;
  } else {
    // 未完了
    if (active.length > 0) {
      html += `<div class="todo-section-title">未完了 (${active.length}件)</div>`;
      html += active.map(todo => renderTodoItem(todo, today)).join('');
    }
    // 完了済み
    if (completed.length > 0) {
      html += `<div class="todo-section-title">完了済み (${completed.length}件)</div>`;
      html += completed.map(todo => renderTodoItem(todo, today)).join('');
    }
  }

  container.innerHTML = html;
}

/**
 * TODOアイテムのHTMLを生成
 */
function renderTodoItem(todo, today) {
  const isOverdue = todo.due_date && !todo.completed && todo.due_date < today;
  const dueDateStr = todo.due_date
    ? `<span class="${isOverdue ? 'due-overdue' : ''}">📅 ${formatDateStr(todo.due_date)}</span>`
    : '';
  const priorityBadge = `<span class="priority-badge priority-${todo.priority}-badge">${PRIORITY_LABELS[todo.priority]}</span>`;

  return `
    <div class="todo-item priority-${todo.priority} ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
      <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''}
             onchange="toggleTodo('${todo.id}', this.checked)">
      <div class="todo-content">
        <div class="todo-item-title">${escHtml(todo.title)}</div>
        <div class="todo-item-meta">
          ${priorityBadge}
          ${dueDateStr}
        </div>
      </div>
      <div class="todo-actions">
        <button class="todo-delete-btn" onclick="deleteTodo('${todo.id}')" title="削除">✕</button>
      </div>
    </div>`;
}

// ----------------------------------------
// モーダル処理
// ----------------------------------------

/**
 * 予定登録モーダルを開く
 */
function openEventModal(dateStr, eventId) {
  editingEventId = eventId || null;
  const modal = document.getElementById('event-modal');
  const form = document.getElementById('event-form');
  form.reset();
  document.getElementById('event-date-display').value = '';

  // 初期値を設定
  if (dateStr) {
    setDateValue('event-date', 'event-date-display', dateStr);
  }

  // 参加者リストを描画
  renderParticipantList();

  // 施設リストを更新
  renderFacilityOptions();

  // 編集の場合はデータを埋め込む
  if (editingEventId) {
    const ev = allEvents.find(e => e.id === editingEventId);
    if (ev) {
      document.getElementById('modal-title-text').textContent = '予定を編集';
      document.getElementById('event-title').value = ev.title;
      setDateValue('event-date', 'event-date-display', toDateStr(new Date(ev.start_datetime)));
      tpSetValue('event-start-time', formatTime(ev.start_datetime));
      tpSetValue('event-end-time', formatTime(ev.end_datetime));
      document.getElementById('event-allday').checked = ev.is_all_day;
      document.getElementById('event-memo').value = ev.memo || '';
      document.getElementById('event-facility').value = ev.facility || '';
      document.getElementById('event-private').checked = ev.is_private || false;

      // 参加者にチェック
      if (ev.event_participants) {
        ev.event_participants.forEach(p => {
          const cb = document.getElementById(`part-${p.user_id}`);
          if (cb) cb.checked = true;
        });
      }

      // タイプボタンを更新
      updateTypeButtons(ev.type);
      // 削除ボタン表示
      document.getElementById('btn-delete-event').classList.remove('hidden');
    }
  } else {
    document.getElementById('modal-title-text').textContent = '予定を追加';
    document.getElementById('event-type-input').value = 'other';
    updateTypeButtons('other');
    document.getElementById('btn-delete-event').classList.add('hidden');
    // 開始時刻は現在の時間（5分刻み切り捨て）、終了は+1時間をデフォルト
    const now = new Date();
    const startH = String(now.getHours()).padStart(2, '0');
    const startM = String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0');
    let endH = now.getHours() + 1;
    if (endH >= 24) endH = 23;
    tpSetValue('event-start-time', `${startH}:${startM}`);
    tpSetValue('event-end-time', `${String(endH).padStart(2, '0')}:${startM}`);
    // 自分をデフォルトで参加者チェック
    const selfCb = document.getElementById(`part-${currentUser.id}`);
    if (selfCb) selfCb.checked = true;
  }

  modal.classList.remove('hidden');
}

/**
 * 予定詳細モーダルを開く
 */
function openEventDetail(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;

  const type = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
  const timeStr = ev.is_all_day
    ? '終日'
    : `${formatDateStr(ev.start_datetime)} ${formatTime(ev.start_datetime)} 〜 ${formatTime(ev.end_datetime)}`;

  const isOwner = ev.user_id === currentUser.id;

  // 参加者
  const participants = ev.event_participants || [];
  const participantsHTML = participants.length > 0
    ? `<div class="participants-chips">
        ${participants.map(p => {
          const profile = p.profiles || allProfiles.find(pr => pr.id === p.user_id) || {};
          return `
            <div class="participant-chip">
              ${escHtml(profile.name || '不明')}
            </div>`;
        }).join('')}
       </div>`
    : '<span style="color:var(--text-secondary);font-size:13px;">なし</span>';

  const ownerProfile = allProfiles.find(p => p.id === ev.user_id) || {};

  document.getElementById('event-detail-content').innerHTML = `
    <div class="event-detail-type" style="background:${type.bg};color:${type.color};">
      ${type.icon} ${type.label}${ev.is_private ? ' <span class="private-badge">🔒 非公開</span>' : ''}
    </div>
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;">${escHtml(ev.title)}</h2>
    <div class="event-detail-row">
      <span class="event-detail-icon">🕐</span>
      <div>
        <div class="event-detail-label">日時</div>
        <div class="event-detail-value">${timeStr}</div>
      </div>
    </div>
    <div class="event-detail-row">
      <span class="event-detail-icon">👤</span>
      <div>
        <div class="event-detail-label">登録者</div>
        <div class="event-detail-value">${escHtml(ownerProfile.name || '不明')}</div>
      </div>
    </div>
    ${ev.facility ? `
    <div class="event-detail-row">
      <span class="event-detail-icon">📍</span>
      <div>
        <div class="event-detail-label">場所</div>
        <div class="event-detail-value">${escHtml(ev.facility)}</div>
      </div>
    </div>` : ''}
    ${ev.memo ? `
    <div class="event-detail-row">
      <span class="event-detail-icon">📝</span>
      <div>
        <div class="event-detail-label">メモ</div>
        <div class="event-detail-value" style="white-space:pre-wrap;">${escHtml(ev.memo)}</div>
      </div>
    </div>` : ''}
    <div class="event-detail-row">
      <span class="event-detail-icon">👥</span>
      <div>
        <div class="event-detail-label">参加者</div>
        <div class="event-detail-value">${participantsHTML}</div>
      </div>
    </div>`;

  // 編集・削除ボタン
  const detailFooter = document.getElementById('event-detail-footer');
  if (isOwner) {
    detailFooter.innerHTML = `
      <button class="btn btn-danger btn-sm" onclick="deleteEvent('${ev.id}')">削除</button>
      <button class="btn btn-secondary btn-sm" onclick="closeModal('event-detail-modal')">閉じる</button>
      <button class="btn btn-primary btn-sm" onclick="closeModal('event-detail-modal');openEventModal(null,'${ev.id}')">編集</button>`;
  } else {
    detailFooter.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="closeModal('event-detail-modal')">閉じる</button>`;
  }

  document.getElementById('event-detail-modal').classList.remove('hidden');
}

/**
 * プロフィールモーダルを開く
 */
function openProfileModal() {
  const profile = currentProfile;
  document.getElementById('profile-name').value = profile.name || '';
  document.getElementById('profile-dept').value = profile.department || '';
  // メール・パスワードフィールドをリセット
  const emailEl = document.getElementById('profile-email');
  const passEl  = document.getElementById('profile-password');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value = '';

  // iCal購読URLを表示
  renderIcalUrls();

  document.getElementById('profile-modal').classList.remove('hidden');
}

// ----------------------------------------
// iCal 購読URL（ライブフィード）
// ----------------------------------------

const ICAL_FEED_BASE = 'https://rrsbyiypwgnwzqadwpky.supabase.co/functions/v1/ical-feed';

/**
 * 設定モーダル内の購読URLを描画
 */
async function renderIcalUrls() {
  const selfInput = document.getElementById('ical-url-self');
  const allInput  = document.getElementById('ical-url-all');
  if (!selfInput || !allInput) return;

  selfInput.value = '';
  allInput.value  = '';
  selfInput.placeholder = '取得中...';
  allInput.placeholder  = '取得中...';

  // select('*') でカラム不存在エラーを回避しつつ再取得
  const { data: fresh, error: fetchErr } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (fetchErr) {
    console.error('プロフィール再取得エラー:', fetchErr);
    selfInput.placeholder = 'DBエラー — Supabaseのセットアップを確認してください';
    allInput.placeholder  = 'DBエラー — Supabaseのセットアップを確認してください';
    return;
  }

  let token = fresh?.ical_token;

  // ical_token カラムが存在しない or NULL → 新規発行を試みる
  if (!token) {
    token = await issueIcalToken();
  } else {
    currentProfile = { ...currentProfile, ...fresh };
  }

  if (token) {
    selfInput.value = `${ICAL_FEED_BASE}?token=${token}`;
    allInput.value  = `${ICAL_FEED_BASE}?token=${token}&target=all`;
    selfInput.placeholder = '';
    allInput.placeholder  = '';
  } else {
    selfInput.placeholder = 'セットアップが必要です（管理者へ連絡）';
    allInput.placeholder  = 'セットアップが必要です（管理者へ連絡）';
  }
}

/**
 * ical_token を新規発行してDBに保存
 */
async function issueIcalToken() {
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .update({ ical_token: crypto.randomUUID() })
      .eq('id', currentUser.id)
      .select('ical_token')
      .single();
    if (error) throw error;
    currentProfile = { ...currentProfile, ical_token: data.ical_token };
    return data.ical_token;
  } catch (err) {
    console.error('ical_token発行エラー:', err);
    // カラムが存在しない場合の案内
    const needsMigration = err.code === '42703'
      || err.message?.includes('ical_token')
      || err.message?.includes('column');
    if (needsMigration) {
      showToast('Supabase SQL Editor でマイグレーションを実行してください（下記SQL）', 'error');
    } else {
      showToast('iCal URL の取得に失敗しました: ' + err.message, 'error');
    }
    return null;
  }
}

/**
 * iCal URLをクリップボードにコピー
 */
async function copyIcalUrl(target) {
  const inputId = target === 'all' ? 'ical-url-all' : 'ical-url-self';
  const input   = document.getElementById(inputId);
  if (!input?.value || !input.value.startsWith('http')) return;
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('URLをコピーしました', 'success');
  } catch {
    // フォールバック（古いブラウザ）
    input.select();
    document.execCommand('copy');
    showToast('URLをコピーしました', 'success');
  }
}

/**
 * iCalトークンを再発行（URLを無効化して新しいURLを発行）
 */
async function resetIcalToken() {
  if (!confirm('現在の購読URLが無効になります。\nGoogleカレンダー等に登録済みの場合は再登録が必要です。\n\n続けますか？')) return;
  showLoading(true);
  try {
    const newToken = crypto.randomUUID();
    const { error } = await supabaseClient
      .from('profiles')
      .update({ ical_token: newToken })
      .eq('id', currentUser.id);
    if (error) throw error;
    currentProfile = { ...currentProfile, ical_token: newToken };
    await renderIcalUrls();
    showToast('購読URLを再発行しました', 'success');
  } catch (err) {
    showToast('再発行に失敗しました: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Googleカレンダーに「URLから追加」するリンクを開く
 */
function openGoogleCalendar() {
  const input = document.getElementById('ical-url-self');
  if (!input?.value || input.value.startsWith('（')) {
    showToast('URLが取得できていません', 'error');
    return false;
  }
  // GoogleカレンダーはWebCalプロトコルを受け付ける
  const webcalUrl = input.value.replace(/^https?:\/\//, 'webcal://');
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  window.open(googleUrl, '_blank');
  return false;
}

/**
 * モーダルを閉じる
 */
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

/**
 * 参加者リストを描画
 */
function renderParticipantList() {
  const list = document.getElementById('participant-list');
  list.innerHTML = allProfiles.map(p => `
    <label class="participant-item">
      <input type="checkbox" id="part-${p.id}" value="${p.id}">
      <span class="participant-name">${escHtml(p.name)}</span>
      <span class="participant-dept">${escHtml(p.department || '')}</span>
    </label>`).join('');
}

/**
 * 施設オプションを描画
 */
function renderFacilityOptions() {
  const sel = document.getElementById('event-facility');
  sel.innerHTML = `<option value="">場所を選択...</option>` +
    allFacilities.map(f => `<option value="${escHtml(f.name)}">${escHtml(f.name)}</option>`).join('');
}

/**
 * 予定タイプボタンの選択状態を更新
 */
function updateTypeButtons(selectedType) {
  document.querySelectorAll('.event-type-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.type === selectedType);
  });
  document.getElementById('event-type-input').value = selectedType;
}

/**
 * カラーパレットを描画
 */
function renderColorPalette(currentColor) {
  const palette = document.getElementById('color-palette');
  palette.innerHTML = AVATAR_COLORS.map(color => `
    <div class="color-dot ${color === currentColor ? 'selected' : ''}"
         style="background:${color};"
         onclick="selectAvatarColor('${color}')"
         data-color="${color}">
    </div>`).join('');
}

/**
 * アバターカラーを選択
 */
function selectAvatarColor(color) {
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.classList.toggle('selected', dot.dataset.color === color);
  });
  document.getElementById('selected-color').value = color;

  // プレビューを更新
  const preview = document.getElementById('profile-avatar-preview');
  if (preview) {
    preview.style.background = color;
  }
}

// ----------------------------------------
// フォーム送信
// ----------------------------------------

/**
 * 予定フォームの送信処理
 */
async function submitEventForm(e) {
  e.preventDefault();
  const form = document.getElementById('event-form');

  const title = document.getElementById('event-title').value.trim();
  const type = document.getElementById('event-type-input').value;
  const dateStr = document.getElementById('event-date').value;
  const isAllDay = document.getElementById('event-allday').checked;
  const startTime = document.getElementById('event-start-time').value;
  const endTime = document.getElementById('event-end-time').value;
  const memo = document.getElementById('event-memo').value.trim();
  const facility = document.getElementById('event-facility').value;

  // 参加者チェックボックスから取得
  const participants = Array.from(document.querySelectorAll('#participant-list input:checked'))
    .map(cb => cb.value);

  if (!title) {
    showToast('タイトルを入力してください', 'error');
    return;
  }
  if (!dateStr) {
    showToast('日付を入力してください', 'error');
    return;
  }

  // 日時を JST として組み立て
  let startDT, endDT;
  if (isAllDay) {
    startDT = `${dateStr}T00:00:00+09:00`;
    endDT   = `${dateStr}T23:59:59+09:00`;
  } else {
    startDT = `${dateStr}T${startTime || '09:00'}:00+09:00`;
    endDT   = `${dateStr}T${endTime || '18:00'}:00+09:00`;
    if (endDT <= startDT) {
      showToast('終了時刻は開始時刻より後にしてください', 'error');
      return;
    }
  }

  const isPrivate = document.getElementById('event-private').checked;

  await saveEvent({
    title,
    type,
    start_datetime: startDT,
    end_datetime: endDT,
    is_all_day: isAllDay,
    memo,
    facility,
    participants,
    is_private: isPrivate,
  });

  closeModal('event-modal');
}

/**
 * TODOフォームの送信処理
 */
async function submitTodoForm(e) {
  e.preventDefault();
  const title = document.getElementById('todo-title').value.trim();
  const dueDate = document.getElementById('todo-due-date').value;
  const priority = document.getElementById('todo-priority').value;

  if (!title) {
    showToast('タイトルを入力してください', 'error');
    return;
  }

  await addTodo(title, dueDate, priority);
  document.getElementById('todo-add-form').reset();
  document.getElementById('todo-add-form').classList.remove('open');
}

// ----------------------------------------
// ミニカレンダー
// ----------------------------------------

/**
 * ミニカレンダーを描画
 */
function renderMiniCalendar() {
  const year = miniCalDate.getFullYear();
  const month = miniCalDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const today = toDateStr(new Date());
  const selected = toDateStr(currentDate);

  // 祝日データ（前後月も考慮）
  if (!holidayCache[year]) holidayCache[year] = getJapaneseHolidays(year);
  if (!holidayCache[year - 1]) holidayCache[year - 1] = getJapaneseHolidays(year - 1);
  if (!holidayCache[year + 1]) holidayCache[year + 1] = getJapaneseHolidays(year + 1);
  const holidays = { ...holidayCache[year - 1], ...holidayCache[year], ...holidayCache[year + 1] };

  let startDow = firstDay.getDay();
  startDow = (startDow + 6) % 7; // 月曜始まり

  document.getElementById('mini-cal-title').textContent = `${year}年${month + 1}月`;

  let gridHTML = '';
  const cursor = new Date(firstDay);
  cursor.setDate(cursor.getDate() - startDow);

  for (let i = 0; i < 42; i++) {
    const day = new Date(cursor);
    const ds = toDateStr(day);
    const isThisMonth = day.getMonth() === month;
    const dow = i % 7; // 0=月
    const holidayName = holidays[ds];

    let cls = 'mini-cal-day';
    if (!isThisMonth) cls += ' other-month';
    if (ds === today) cls += ' today';
    else if (ds === selected) cls += ' selected';
    if (dow === 6 || holidayName) cls += ' sunday';
    else if (dow === 5) cls += ' saturday';

    const titleAttr = holidayName ? ` title="${holidayName}"` : '';
    gridHTML += `<div class="${cls}"${titleAttr} onclick="miniCalDayClick('${ds}')">${day.getDate()}</div>`;
    cursor.setDate(cursor.getDate() + 1);
  }

  document.getElementById('mini-cal-grid').innerHTML = gridHTML;
}

/**
 * ミニカレンダーの日付クリック処理
 */
async function miniCalDayClick(dateStr) {
  currentDate = new Date(dateStr + 'T00:00:00');
  // ミニカレンダーの月も合わせる
  miniCalDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  renderMiniCalendar();
  await refreshCurrentView();
}

// ----------------------------------------
// ナビゲーション
// ----------------------------------------

/**
 * 前へ移動
 */
async function navigatePrev() {
  currentDate = shiftDate(currentDate, -1);
  await refreshCurrentView();
  renderMiniCalendar();
}

/**
 * 次へ移動
 */
async function navigateNext() {
  currentDate = shiftDate(currentDate, 1);
  await refreshCurrentView();
  renderMiniCalendar();
}

/**
 * 今日/今週/今月に移動
 */
async function navigateToday() {
  currentDate = new Date();
  miniCalDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  await refreshCurrentView();
  renderMiniCalendar();
}

/**
 * ビューに応じて日付をシフト
 */
function shiftDate(date, direction) {
  const d = new Date(date);
  switch (currentView) {
    case 'group-week':
    case 'personal-week':
      d.setDate(d.getDate() + 7 * direction);
      break;
    case 'personal-month':
      d.setMonth(d.getMonth() + direction);
      break;
    default:
      d.setDate(d.getDate() + direction);
  }
  return d;
}

// ----------------------------------------
// ページ切り替え
// ----------------------------------------

/**
 * スケジュールページに切り替え
 */
function showSchedulePage() {
  currentPage = 'schedule';
  document.getElementById('page-schedule').classList.remove('hidden');
  document.getElementById('page-todo').classList.add('hidden');
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('nav-schedule').classList.add('active');
  document.getElementById('nav-todo').classList.remove('active');
}

/**
 * TODOページに切り替え
 */
function showTodoPage() {
  currentPage = 'todo';
  document.getElementById('page-schedule').classList.add('hidden');
  document.getElementById('page-todo').classList.remove('hidden');
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('nav-schedule').classList.remove('active');
  document.getElementById('nav-todo').classList.add('active');
  renderTodos();
}

/**
 * ビューを切り替え
 */
async function switchView(view) {
  currentView = view;

  // タブの active 状態を更新
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  await refreshCurrentView();
}

// ----------------------------------------
// UI 表示制御
// ----------------------------------------

/**
 * ローディングオーバーレイを表示/非表示
 * 非表示時はフェードアウトしてから display:none（CSSトランジション連携）
 */
function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  if (show) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

/**
 * トースト通知を表示
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${escHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/**
 * 認証画面を表示
 */
function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

/**
 * アプリ画面を表示
 */
function showAppScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  renderMiniCalendar();
  updateHeaderUser();
}

/**
 * ヘッダーのユーザー情報を更新
 */
function updateHeaderUser() {
  if (!currentProfile) return;
  const nameEl = document.getElementById('header-user-name');
  if (nameEl) nameEl.textContent = currentProfile.name;
}

// ----------------------------------------
// ユーティリティ関数
// ----------------------------------------

/**
 * 指定日のイベントを取得
 * @param {Date} date
 * @param {string} userId
 * @param {boolean} ownerOnly - trueのとき自分が登録した予定のみ（個人月ビュー用）
 */
function getEventsOnDay(date, userId, ownerOnly = false) {
  const ds = toDateStr(date);
  return allEvents.filter(ev => {
    if (userId) {
      const isOwner = ev.user_id === userId;
      if (ownerOnly) {
        if (!isOwner) return false;
      } else {
        const isParticipant = ev.event_participants?.some(p => p.user_id === userId);
        if (!isOwner && !isParticipant) return false;
      }
    }
    const start = toDateStr(new Date(ev.start_datetime));
    const end = toDateStr(new Date(ev.end_datetime));
    return start <= ds && ds <= end;
  });
}

/**
 * 指定日・時間帯のイベントを取得
 */
function getEventsInHour(date, hour, userId) {
  const ds = toDateStr(date);
  return allEvents.filter(ev => {
    const isOwner = ev.user_id === userId;
    const isParticipant = ev.event_participants?.some(p => p.user_id === userId);
    if (!isOwner && !isParticipant) return false;
    if (ev.is_all_day) return false;
    const evDate = toDateStr(new Date(ev.start_datetime));
    const evHour = new Date(ev.start_datetime).getHours();
    return evDate === ds && evHour === hour;
  });
}

/**
 * 週の開始（月曜）〜終了（日曜）を取得
 */
function getWeekRange(date) {
  const d = new Date(date);
  const dow = d.getDay(); // 0=日
  const diff = (dow === 0) ? -6 : 1 - dow; // 月曜へのオフセット
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return [start, end];
}

/**
 * 月の開始〜終了を取得
 */
function getMonthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
  return [start, end];
}

/**
 * 開始〜終了の日付配列を生成
 */
function getDaysInRange(start, end) {
  const days = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Date を "YYYY-MM-DD" 形式の文字列に変換
 */
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Date を ISO 文字列に変換
 */
function toISO(date) {
  return date.toISOString();
}

/**
 * 日の開始（00:00:00）を取得
 */
function startOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 日の終了（23:59:59）を取得
 */
function endOf(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * 日時から時刻文字列（HH:MM）を取得
 */
function formatTime(dt) {
  const d = new Date(dt);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/**
 * 日付フォーマット
 */
function formatDate(date, fmt) {
  const d = new Date(date);
  return fmt
    .replace('YYYY', d.getFullYear())
    .replace('M', d.getMonth() + 1)
    .replace('D', d.getDate())
    .replace('${dow}', DOW_JA[d.getDay()]);
}

/**
 * 日付文字列をフォーマット
 */
function formatDateStr(dtStr) {
  const d = new Date(dtStr);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

/**
 * 名前からイニシャルを生成
 */
function getInitials(name) {
  if (!name) return '?';
  // 日本語の場合は最初の1文字
  const trimmed = name.trim();
  if (/[\u3000-\u9fff]/.test(trimmed)) {
    return trimmed.charAt(0);
  }
  // 英語の場合は頭文字2文字
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return parts[0][0].toUpperCase() + parts[1][0].toUpperCase();
  return trimmed.charAt(0).toUpperCase();
}

/**
 * HTML エスケープ
 */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ----------------------------------------
// iCalエクスポート
// ----------------------------------------

/**
 * iCalモーダルを開く（デフォルトで今月を設定）
 */
function openIcalModal() {
  setIcalRange('this-month');
  updateIcalCount();
  document.getElementById('ical-modal').classList.remove('hidden');
}

/**
 * iCal期間ショートカット
 */
function setIcalRange(type) {
  const today = new Date();
  let start, end;
  if (type === 'this-month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (type === 'next-month') {
    start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    end   = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  } else if (type === '3months') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end   = new Date(today.getFullYear(), today.getMonth() + 3, 0);
  } else if (type === 'this-year') {
    start = new Date(today.getFullYear(), 0, 1);
    end   = new Date(today.getFullYear(), 11, 31);
  }
  document.getElementById('ical-start').value = toDateStr(start);
  document.getElementById('ical-end').value   = toDateStr(end);
  updateIcalCount();
}

/**
 * iCal件数プレビューを更新
 */
function updateIcalCount() {
  const startVal = document.getElementById('ical-start')?.value;
  const endVal   = document.getElementById('ical-end')?.value;
  const targetAll = document.getElementById('ical-target-all')?.checked;
  const countEl = document.getElementById('ical-count');
  if (!countEl || !startVal || !endVal) return;
  const events = getIcalEvents(startVal, endVal, targetAll);
  countEl.textContent = `対象の予定: ${events.length} 件`;
}

/**
 * フィルタした予定リストを返す
 */
function getIcalEvents(startStr, endStr, allUsers) {
  return allEvents.filter(ev => {
    const evStart = toDateStr(new Date(ev.start_datetime));
    const evEnd   = toDateStr(new Date(ev.end_datetime));
    if (evEnd < startStr || evStart > endStr) return false;
    if (!allUsers && ev.user_id !== currentUser.id) return false;
    return true;
  });
}

/**
 * iCalファイルを生成してダウンロード
 */
function downloadIcal() {
  const startVal  = document.getElementById('ical-start').value;
  const endVal    = document.getElementById('ical-end').value;
  const targetAll = document.getElementById('ical-target-all')?.checked;

  if (!startVal || !endVal) {
    showToast('期間を指定してください', 'error');
    return;
  }
  if (startVal > endVal) {
    showToast('開始日が終了日より後になっています', 'error');
    return;
  }

  const events = getIcalEvents(startVal, endVal, targetAll);
  if (events.length === 0) {
    showToast('該当する予定がありません', 'info');
    return;
  }

  const icsEscape = (str) =>
    (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const icsDateTime = (dtStr, allDay) => {
    const d = new Date(dtStr);
    if (allDay) {
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }
    const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const hms = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}00`;
    return `${ymd}T${hms}`;
  };

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FRex Design Inc.//FRex Schedule//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:FRex Schedule',
    'X-WR-TIMEZONE:Asia/Tokyo',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  events.forEach(ev => {
    const uid = `${ev.id}@frex-schedule`;
    const ownerProfile = allProfiles.find(p => p.id === ev.user_id);
    const ownerName = ownerProfile ? ownerProfile.name : '';
    const typeInfo = EVENT_TYPES[ev.type] || EVENT_TYPES['other'];
    const summary = targetAll && ownerName
      ? `[${ownerName}] ${icsEscape(ev.title)}`
      : icsEscape(ev.title);

    let lines = ['BEGIN:VEVENT', `UID:${uid}`];

    if (ev.is_all_day) {
      // 終日イベント（VALUE=DATE）
      const d = new Date(ev.end_datetime);
      d.setDate(d.getDate() + 1); // iCalの終日は翌日が終了
      const endDate = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      lines.push(`DTSTART;VALUE=DATE:${icsDateTime(ev.start_datetime, true)}`);
      lines.push(`DTEND;VALUE=DATE:${endDate}`);
    } else {
      lines.push(`DTSTART;TZID=Asia/Tokyo:${icsDateTime(ev.start_datetime, false)}`);
      lines.push(`DTEND;TZID=Asia/Tokyo:${icsDateTime(ev.end_datetime, false)}`);
    }

    lines.push(`SUMMARY:${summary}`);
    if (ev.memo) lines.push(`DESCRIPTION:${icsEscape(ev.memo)}`);

    const facility = allFacilities.find(f => f.id === ev.facility_id);
    if (facility) lines.push(`LOCATION:${icsEscape(facility.name)}`);

    lines.push(`CATEGORIES:${icsEscape(typeInfo.label)}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
    ics = ics.concat(lines);
  });

  ics.push('END:VCALENDAR');

  const blob = new Blob([ics.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const label = targetAll ? 'frex-schedule-all' : `frex-schedule-${currentProfile?.name || 'me'}`;
  a.href     = url;
  a.download = `${label}_${startVal}_${endVal}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`${events.length}件の予定をエクスポートしました`, 'success');
  closeModal('ical-modal');
}

// ============================================================
// カスタム日付ピッカー
// ============================================================

let _dpHiddenId   = null;
let _dpDisplayId  = null;
let _dpYear       = new Date().getFullYear();
let _dpMonth      = new Date().getMonth();

const DP_MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const DP_DOWS   = ['日','月','火','水','木','金','土'];

/** 日付の値を hidden + display 両方にセット */
function setDateValue(hiddenId, displayId, dateStr) {
  document.getElementById(hiddenId).value = dateStr || '';
  const disp = document.getElementById(displayId);
  if (!disp) return;
  if (dateStr) {
    const d   = new Date(dateStr + 'T00:00:00');
    const dow = DP_DOWS[d.getDay()];
    disp.value = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dow}）`;
  } else {
    disp.value = '';
  }
}

/** ピッカーを開く / 同じ入力ならトグル */
function toggleDatePicker(triggerEl, hiddenId) {
  const popup  = document.getElementById('date-picker-popup');
  const isOpen = !popup.classList.contains('hidden') && _dpHiddenId === hiddenId;
  closeDatePicker();
  if (isOpen) return;

  _dpHiddenId  = hiddenId;
  _dpDisplayId = triggerEl.id;

  const val = document.getElementById(hiddenId).value;
  if (val) {
    const d = new Date(val + 'T00:00:00');
    _dpYear  = d.getFullYear();
    _dpMonth = d.getMonth();
  } else {
    const now = new Date();
    _dpYear  = now.getFullYear();
    _dpMonth = now.getMonth();
  }

  _renderDatePicker();

  // fixed 位置を計算
  const rect = triggerEl.getBoundingClientRect();
  popup.style.top  = `${rect.bottom + 6}px`;
  popup.style.left = `${rect.left}px`;
  popup.classList.remove('hidden');

  // 右端はみ出し補正
  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      popup.style.left = `${window.innerWidth - pr.width - 8}px`;
    }
  });
}

function closeDatePicker() {
  document.getElementById('date-picker-popup').classList.add('hidden');
}

function _renderDatePicker() {
  const popup     = document.getElementById('date-picker-popup');
  const selVal    = _dpHiddenId ? document.getElementById(_dpHiddenId).value : '';
  const todayStr  = toDateStr(new Date());
  const firstDow  = new Date(_dpYear, _dpMonth, 1).getDay();
  const lastDate  = new Date(_dpYear, _dpMonth + 1, 0).getDate();

  const dowHdr = DP_DOWS.map((l, i) =>
    `<div class="dp-cell dp-dow${i === 0 ? ' dp-sun' : i === 6 ? ' dp-sat' : ''}">${l}</div>`
  ).join('');

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="dp-cell dp-blank"></div>`;
  for (let d = 1; d <= lastDate; d++) {
    const ds  = `${_dpYear}-${String(_dpMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = (firstDow + d - 1) % 7;
    let cls = 'dp-cell dp-day';
    if (ds === selVal)    cls += ' dp-sel';
    else if (ds === todayStr) cls += ' dp-today';
    if (dow === 0) cls += ' dp-sun';
    if (dow === 6) cls += ' dp-sat';
    cells += `<div class="${cls}" onclick="dpPick('${ds}')">${d}</div>`;
  }

  popup.innerHTML = `
    <div class="dp-header">
      <button type="button" class="dp-nav-btn" onclick="dpNav(-1)"><i data-lucide="chevron-left"></i></button>
      <span class="dp-title">${_dpYear}年 ${DP_MONTHS[_dpMonth]}</span>
      <button type="button" class="dp-nav-btn" onclick="dpNav(1)"><i data-lucide="chevron-right"></i></button>
    </div>
    <div class="dp-grid">${dowHdr}${cells}</div>
    <div class="dp-footer">
      <button type="button" class="dp-today-btn" onclick="dpPick('${todayStr}')">今日</button>
    </div>`;

  lucide.createIcons({ context: popup });
}

function dpNav(delta) {
  _dpMonth += delta;
  if (_dpMonth < 0)  { _dpMonth = 11; _dpYear--; }
  if (_dpMonth > 11) { _dpMonth = 0;  _dpYear++; }
  _renderDatePicker();
}

function dpPick(dateStr) {
  setDateValue(_dpHiddenId, _dpDisplayId, dateStr);
  closeDatePicker();
}

// ポップアップ外クリックで閉じる
document.addEventListener('click', e => {
  if (!e.target.closest('.dp-wrapper') && !e.target.closest('#date-picker-popup')) {
    closeDatePicker();
  }
}, true);

// ----------------------------------------
// DOMContentLoaded 後に初期化
// ----------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  // ============================================================
  // 認証画面のイベントリスナー
  // ============================================================

  // タブ切り替え
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('login-form').classList.toggle('hidden', target !== 'login');
      document.getElementById('signup-form').classList.toggle('hidden', target !== 'signup');
      document.getElementById('reset-form').classList.add('hidden');
    });
  });

  // パスワードをお忘れですか？リンク
  document.getElementById('forgot-password-link').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('reset-form').classList.remove('hidden');
  });

  // ログインに戻るリンク
  document.getElementById('back-to-login-link').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('reset-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
  });

  // パスワードリセットフォーム
  document.getElementById('reset-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('reset-email').value;
    await sendPasswordReset(email);
  });

  // ログインフォーム
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    await signIn(email, password);
  });

  // サインアップフォーム
  document.getElementById('signup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    await signUp(name, email, password, '');
  });

  // ============================================================
  // アプリ画面のイベントリスナー
  // ============================================================

  // ヘッダーナビゲーション
  document.getElementById('nav-schedule').addEventListener('click', showSchedulePage);
  document.getElementById('nav-todo').addEventListener('click', showTodoPage);

  // ログアウト
  document.getElementById('btn-logout').addEventListener('click', signOut);

  // 設定ボタン → アカウント設定モーダル
  document.getElementById('btn-settings').addEventListener('click', openProfileModal);

  // ガイドボタン → 操作ガイドモーダル
  document.getElementById('btn-guide').addEventListener('click', () => {
    document.getElementById('guide-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-guide-modal').addEventListener('click', () => closeModal('guide-modal'));


  // カレンダーナビゲーション
  document.getElementById('btn-prev').addEventListener('click', navigatePrev);
  document.getElementById('btn-next').addEventListener('click', navigateNext);
  document.getElementById('btn-today').addEventListener('click', navigateToday);

  // 予定追加ボタン
  document.getElementById('btn-add-event').addEventListener('click', () => {
    openEventModal(toDateStr(currentDate));
  });

  // ビュータブ
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // ミニカレンダーのナビゲーション
  document.getElementById('mini-cal-prev').addEventListener('click', () => {
    miniCalDate.setMonth(miniCalDate.getMonth() - 1);
    renderMiniCalendar();
  });

  document.getElementById('mini-cal-next').addEventListener('click', () => {
    miniCalDate.setMonth(miniCalDate.getMonth() + 1);
    renderMiniCalendar();
  });

  // ============================================================
  // 予定モーダルのイベントリスナー
  // ============================================================

  // 終日チェックボックス
  document.getElementById('event-allday').addEventListener('change', e => {
    const disabled = e.target.checked;
    document.getElementById('event-start-time').disabled = disabled;
    document.getElementById('event-end-time').disabled = disabled;
  });

  // フォーム送信
  document.getElementById('event-form').addEventListener('submit', submitEventForm);

  // モーダル閉じる
  document.getElementById('btn-close-event-modal').addEventListener('click', () => closeModal('event-modal'));
  document.getElementById('btn-cancel-event').addEventListener('click', () => closeModal('event-modal'));
  document.getElementById('btn-close-detail-modal').addEventListener('click', () => closeModal('event-detail-modal'));
  document.getElementById('btn-close-profile-modal').addEventListener('click', () => closeModal('profile-modal'));

  // イベント削除（モーダル内）
  document.getElementById('btn-delete-event').addEventListener('click', async () => {
    if (editingEventId) {
      closeModal('event-modal');
      await deleteEvent(editingEventId);
    }
  });

  // モーダル外クリックで閉じる
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });

  // 予定タイプボタン
  document.querySelectorAll('.event-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      updateTypeButtons(type);
      // テレワーク・テレハーフはタイトルを自動入力
      const titleInput = document.getElementById('event-title');
      const alldayCheckbox = document.getElementById('event-allday');
      if (type === 'telework') {
        titleInput.value = 'テレワーク';
        titleInput.readOnly = true;
        alldayCheckbox.checked = true;
      } else if (type === 'tele-half') {
        titleInput.value = 'テレハーフ';
        titleInput.readOnly = true;
        alldayCheckbox.checked = false;
      } else if (type === 'holiday') {
        titleInput.value = '有給休暇';
        titleInput.readOnly = false;
        alldayCheckbox.checked = true;
      } else {
        // 他のタイプに切り替えたらreadOnlyを解除（テレワーク系の自動入力だった場合はクリア）
        if (titleInput.readOnly) {
          titleInput.value = '';
          titleInput.readOnly = false;
          alldayCheckbox.checked = false;
        }
      }
    });
  });

  // ============================================================
  // プロフィールモーダル
  // ============================================================

  document.getElementById('profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('profile-name').value.trim();
    const department = document.getElementById('profile-dept').value.trim();
    const newEmail    = (document.getElementById('profile-email')?.value || '').trim();
    const newPassword = (document.getElementById('profile-password')?.value || '').trim();
    if (!name) {
      showToast('名前を入力してください', 'error');
      return;
    }
    showLoading(true);
    try {
      // Auth更新（メール・パスワード）
      if (newEmail || newPassword) {
        await updateAuthCredentials(newEmail || null, newPassword || null);
      }
      // プロフィール更新
      await updateProfile({ name, department });
    } catch (err) {
      showToast('更新に失敗しました: ' + err.message, 'error');
    } finally {
      showLoading(false);
    }
  });

  // ============================================================
  // TODOフォーム
  // ============================================================

  document.getElementById('btn-add-todo').addEventListener('click', () => {
    const form = document.getElementById('todo-add-form');
    form.classList.toggle('open');
  });

  document.getElementById('todo-form').addEventListener('submit', submitTodoForm);

  // ============================================================
  // キーボードショートカット
  // ============================================================
  document.addEventListener('keydown', e => {
    // ESC でモーダルを閉じる
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => {
        m.classList.add('hidden');
      });
    }
  });

  // 時刻ピッカーを初期化
  initTimePickers();

  // ============================================================
  // アプリ起動
  // ============================================================
  init();
});

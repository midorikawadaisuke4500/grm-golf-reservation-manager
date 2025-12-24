/**
 * Golf Reservation Manager (GRM) - Merger
 * 予定マージモジュール
 * 
 * Stage 6: 親予定と子予定のマージ機能（目玉機能）
 * 
 * 機能:
 * - スコアリングによる親候補の検出
 * - 複数候補時の選択機能
 * - マージ実行とログ記録
 */

const Merger = {
  MERGED_TAG: '＜マージ済み＞',
  
  // スコアリング設定
  SCORE: {
    LOCATION_MATCH: 100,      // 場所一致
    TITLE_KEYWORD: 50,        // タイトルキーワード一致（1キーワードごと）
    MEMO_KEYWORD: 30,         // メモキーワード一致（1キーワードごと）
    TIME_PROXIMITY_MAX: 10    // 時間近接度（最大）
  },
  
  /**
   * 親候補をスコアリングして検出
   * @param {string} date - 対象日付 (YYYY-MM-DD)
   * @param {Object} childEvent - 子イベント情報
   * @returns {Array<Object>} スコア付き親候補リスト
   */
  findParentCandidates(date, childEvent) {
    GRMLogger.info('Stage6', '親候補検出開始', { date });
    
    // マージ設定を取得
    const mergeEnabled = String(Config.get('MERGE_ENABLED')).toLowerCase() === 'true';
    if (!mergeEnabled) {
      GRMLogger.info('Stage6', 'マージ機能無効');
      return [];
    }
    
    const titleKeywords = (Config.get('MERGE_TITLE_KEYWORDS') || 'ゴルフ,麻倉').split(',');
    const memoKeywords = (Config.get('MERGE_MEMO_KEYWORDS') || '').split(',').filter(k => k);
    const locationKeyword = Config.get('MERGE_LOCATION') || '麻倉ゴルフ倶楽部';
    const timeTolerance = parseInt(Config.get('MERGE_TIME_TOLERANCE')) || 60;
    const minScore = parseInt(Config.get('MERGE_MIN_SCORE')) || 50;
    
    // カレンダーから同日の全イベントを取得
    const calendarId = Config.get('CALENDAR_ID');
    const calendar = CalendarApp.getCalendarById(calendarId);
    
    if (!calendar) {
      GRMLogger.error('Stage6', 'カレンダー取得失敗');
      return [];
    }
    
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const allEvents = calendar.getEvents(startOfDay, endOfDay);
    const candidates = [];
    
    for (const event of allEvents) {
      const title = event.getTitle() || '';
      const description = event.getDescription() || '';
      const location = event.getLocation() || '';
      
      // 既にマージ済みはスキップ
      if (title.includes(this.MERGED_TAG)) {
        continue;
      }
      
      // GRMシステムが登録したイベント（子）はスキップ
      if (description.includes('[System:GolfMgr]')) {
        continue;
      }
      
      // スコア計算
      let score = 0;
      const matchedConditions = [];
      
      // 場所一致
      if (location && location.includes(locationKeyword)) {
        score += this.SCORE.LOCATION_MATCH;
        matchedConditions.push('場所一致');
      }
      
      // タイトルキーワード
      for (const keyword of titleKeywords) {
        if (keyword && title.includes(keyword)) {
          score += this.SCORE.TITLE_KEYWORD;
          matchedConditions.push(`タイトル:${keyword}`);
        }
      }
      
      // メモキーワード
      for (const keyword of memoKeywords) {
        if (keyword && description.includes(keyword)) {
          score += this.SCORE.MEMO_KEYWORD;
          matchedConditions.push(`メモ:${keyword}`);
        }
      }
      
      // 時間近接度（子イベントの時間との差）
      if (childEvent && childEvent.time) {
        const parentStartHour = event.getStartTime().getHours();
        const parentStartMinute = event.getStartTime().getMinutes();
        const parentMinutes = parentStartHour * 60 + parentStartMinute;
        
        // childEvent.time が Date型 または 文字列型に対応
        let childMinutes = 0;
        if (childEvent.time instanceof Date) {
          childMinutes = childEvent.time.getHours() * 60 + childEvent.time.getMinutes();
        } else if (typeof childEvent.time === 'string') {
          const childTimeParts = childEvent.time.split(':');
          childMinutes = parseInt(childTimeParts[0]) * 60 + parseInt(childTimeParts[1] || 0);
        }
        
        const timeDiff = Math.abs(parentMinutes - childMinutes);
        
        if (timeDiff <= timeTolerance) {
          const proximityScore = Math.max(0, this.SCORE.TIME_PROXIMITY_MAX - Math.floor(timeDiff / 10));
          score += proximityScore;
          matchedConditions.push(`時間近接(${timeDiff}分差)`);
        }
      }
      
      // 最低スコア以上なら候補に追加
      if (score >= minScore) {
        candidates.push({
          id: event.getId(),
          title: title,
          description: description,
          location: location,
          startTime: event.getStartTime(),
          endTime: event.getEndTime(),
          score: score,
          matchedConditions: matchedConditions,
          event: event
        });
      }
    }
    
    // スコア順にソート（高い順）
    candidates.sort((a, b) => b.score - a.score);
    
    GRMLogger.info('Stage6', '親候補検出完了', { 
      candidateCount: candidates.length,
      candidates: candidates.map(c => ({ title: c.title, score: c.score }))
    });
    
    return candidates;
  },
  
  /**
   * マージ実行（親を指定）
   * @param {Object} childEvent - 子イベント情報
   * @param {Object} parentCandidate - 親候補（findParentCandidatesの結果から1つ）
   * @returns {Object} マージ結果
   */
  executeMergeWithParent(childEvent, parentCandidate) {
    GRMLogger.info('Stage6', 'マージ実行開始', { 
      childId: childEvent.id,
      parentId: parentCandidate.id 
    });
    
    try {
      const calendarId = Config.get('CALENDAR_ID');
      const calendar = CalendarApp.getCalendarById(calendarId);
      
      // 1. 親イベントを取得（タイトルは変更しない）
      const parentEvent = parentCandidate.event || calendar.getEventById(parentCandidate.id);
      const parentDescription = parentEvent ? (parentEvent.getDescription() || '') : '';
      
      GRMLogger.info('Stage6', '親イベント取得', { 
        parentTitle: parentEvent ? parentEvent.getTitle() : 'なし',
        hasDescription: !!parentDescription
      });
      
      // 2. 子カレンダーイベントのメモに親メモを追加
      const childCalendarEvent = calendar.getEventById(childEvent.calendarEventId || childEvent.id);
      if (childCalendarEvent) {
        const childDescription = childCalendarEvent.getDescription() || '';
        
        // 子メモ + 親メモ を結合
        let newDescription = childDescription;
        if (parentDescription) {
          newDescription = childDescription + 
            '\n\n--- 親予定からのメモ ---\n' + 
            parentDescription;
        }
        
        childCalendarEvent.setDescription(newDescription);
        
        // 子タイトルに「＜マージ済み＞」を付加
        const newChildTitle = `${this.MERGED_TAG}${childCalendarEvent.getTitle()}`;
        childCalendarEvent.setTitle(newChildTitle);
        
        GRMLogger.info('Stage6', '子イベント更新', { 
          newTitle: newChildTitle,
          descriptionUpdated: true
        });
      }
      
      // 3. マージログを記録
      this.logMergeV2(childEvent, parentCandidate);
      
      // 4. スプシのステータスを更新
      this.updateReservationMergeStatus(childEvent.reservationId, parentCandidate);
      
      GRMLogger.info('Stage6', 'マージ実行完了');
      
      return {
        success: true,
        message: 'マージ完了',
        parentId: parentCandidate.id,
        childId: childEvent.id
      };
      
    } catch (e) {
      GRMLogger.error('Stage6', 'マージ実行エラー', { error: e.message });
      return { success: false, message: e.message };
    }
  },
  
  /**
   * マージログを記録（V2）
   */
  logMergeV2(childEvent, parentCandidate) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let logSheet = ss.getSheetByName(Config.SHEET_NAMES.MERGE_LOG);
      
      if (!logSheet) {
        logSheet = ss.insertSheet(Config.SHEET_NAMES.MERGE_LOG);
        logSheet.getRange('A1:H1').setValues([[
          'MergeID', 'Date', 'ChildReservationID', 'ChildEventID', 'ParentEventID', 'ParentTitle', 'Score', 'MergedAt'
        ]]);
        logSheet.getRange('A1:H1').setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
      }
      
      const mergeId = Utilities.getUuid();
      
      logSheet.appendRow([
        mergeId,
        childEvent.date || new Date().toISOString().split('T')[0],
        childEvent.reservationId || '',
        childEvent.calendarEventId || childEvent.id || '',
        parentCandidate.id,
        parentCandidate.title,
        parentCandidate.score,
        new Date().toISOString()
      ]);
      
    } catch (e) {
      GRMLogger.warn('Stage6', 'マージログ記録エラー', { error: e.message });
    }
  },
  
  /**
   * Reservation_DBのマージステータスを更新
   */
  updateReservationMergeStatus(reservationId, parentCandidate) {
    if (!reservationId) return;
    
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(Config.SHEET_NAMES.RESERVATION_DB);
      
      if (!sheet) return;
      
      const data = sheet.getDataRange().getValues();
      
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === reservationId) {
          // ステータスを 'merged' に更新
          sheet.getRange(i + 1, 7).setValue('merged');
          // 備考にマージ情報を追記
          const currentNote = data[i][11] || '';
          const mergeNote = `マージ済み(親:${parentCandidate.title.substring(0, 20)}, スコア:${parentCandidate.score})`;
          sheet.getRange(i + 1, 12).setValue(currentNote ? `${currentNote} | ${mergeNote}` : mergeNote);
          break;
        }
      }
    } catch (e) {
      GRMLogger.warn('Stage6', 'ステータス更新エラー', { error: e.message });
    }
  },
  
  /**
   * カレンダー登録後にマージ処理を実行
   * @param {Object} reservation - 予約情報
   * @param {string} calendarEventId - 登録されたカレンダーイベントID
   * @returns {Object} マージ結果
   */
  processAfterCalendarRegistration(reservation, calendarEventId) {
    GRMLogger.info('Stage6', 'カレンダー登録後マージ処理開始');
    
    const childEvent = {
      id: calendarEventId,
      calendarEventId: calendarEventId,
      reservationId: reservation.id,
      date: reservation.date,
      time: reservation.time
    };
    
    // 親候補を検出
    const candidates = this.findParentCandidates(reservation.date, childEvent);
    
    if (candidates.length === 0) {
      GRMLogger.info('Stage6', 'マージ対象なし');
      return { success: true, merged: false, message: 'マージ対象なし' };
    }
    
    const autoScoreDiff = parseInt(Config.get('MERGE_AUTO_SCORE_DIFF')) || 30;
    
    if (candidates.length === 1) {
      // 候補が1つなら自動マージ
      const result = this.executeMergeWithParent(childEvent, candidates[0]);
      return { ...result, merged: true, autoMerged: true };
    }
    
    // 複数候補の場合、スコア差を確認
    const scoreDiff = candidates[0].score - candidates[1].score;
    
    if (scoreDiff >= autoScoreDiff) {
      // スコア差が十分なら自動マージ
      const result = this.executeMergeWithParent(childEvent, candidates[0]);
      return { ...result, merged: true, autoMerged: true };
    }
    
    // 複数候補がありユーザー選択が必要
    GRMLogger.info('Stage6', '複数候補あり、ユーザー選択必要', { 
      candidateCount: candidates.length 
    });
    
    return {
      success: true,
      merged: false,
      needsSelection: true,
      candidates: candidates.map(c => ({
        id: c.id,
        title: c.title,
        score: c.score,
        matchedConditions: c.matchedConditions,
        startTime: c.startTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      })),
      childEvent: childEvent
    };
  },
  
  // ========================================
  // 以下は既存機能（後方互換性のため残す）
  // ========================================
  
  /**
   * マージ対象の予定を検出（旧バージョン）
   */
  detectMergeCandidates(date) {
    GRMLogger.info('Stage6', 'マージ候補検出開始', { date });
    
    const parent = GRMCalendar.findParentEvent(date);
    const children = GRMCalendar.findChildEvents(date);
    
    const unmergedChildren = children.filter(c => 
      !c.title.includes(this.MERGED_TAG)
    );
    
    const result = {
      date,
      hasParent: !!parent,
      parent: parent,
      children: unmergedChildren,
      canMerge: !!parent && unmergedChildren.length > 0
    };
    
    return result;
  },

  /**
   * 全予約日のマージ候補を検出
   * @returns {Array<Object>} マージ可能な予定のリスト
   */
  detectAllMergeCandidates() {
    try {
      GRMLogger.info('Stage6', '全マージ候補検出開始');
      
      // マージ機能が無効なら空配列を返す
      const mergeEnabled = String(Config.get('MERGE_ENABLED')).toLowerCase() === 'true';
      if (!mergeEnabled) {
        return [];
      }
      
      // 今後の予約を取得
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const dbSheet = ss.getSheetByName(Config.SHEET_NAMES.RESERVATION_DB);
      
      if (!dbSheet) {
        return [];
      }
      
      const data = dbSheet.getDataRange().getValues();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const allCandidates = [];
      const checkedDates = new Set();
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const status = row[6];
        
        // confirmed または merged でない予約をスキップ
        if (status !== 'confirmed' && status !== 'pending') {
          continue;
        }
        
        // 日付を取得
        let dateValue = row[2];
        if (!(dateValue instanceof Date)) {
          continue;
        }
        
        // 過去の日付はスキップ
        if (dateValue < today) {
          continue;
        }
        
        // YYYY-MM-DD形式に変換
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        const dateStr = year + '-' + month + '-' + day;
        
        // 同じ日付は一度だけチェック
        if (checkedDates.has(dateStr)) {
          continue;
        }
        checkedDates.add(dateStr);
        
        // この日付のマージ候補を検出
        const candidates = this.detectMergeCandidates(dateStr);
        
        if (candidates.canMerge) {
          allCandidates.push(candidates);
        }
      }
      
      GRMLogger.info('Stage6', '全マージ候補検出完了', { 
        count: allCandidates.length 
      });
      
      return allCandidates;
      
    } catch (e) {
      GRMLogger.error('Stage6', '全マージ候補検出エラー', { error: e.message });
      return [];
    }
  },

  /**
   * マージ履歴を取得
   */
  getMergeHistory(limit = 20) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const logSheet = ss.getSheetByName(Config.SHEET_NAMES.MERGE_LOG);
      
      if (!logSheet) {
        return [];
      }
      
      const data = logSheet.getDataRange().getValues();
      const history = [];
      
      for (let i = data.length - 1; i >= 1 && history.length < limit; i--) {
        const row = data[i];
        history.push({
          mergeId: row[0],
          date: row[1],
          childReservationId: row[2],
          childEventId: row[3],
          parentEventId: row[4],
          parentTitle: row[5],
          score: row[6],
          mergedAt: row[7]
        });
      }
      
      return history;
      
    } catch (e) {
      GRMLogger.error('Stage6', 'マージ履歴取得エラー', { error: e.message });
      return [];
    }
  }
};

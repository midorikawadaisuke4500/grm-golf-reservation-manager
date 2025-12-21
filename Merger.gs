/**
 * Golf Reservation Manager (GRM) - Merger
 * 予定マージモジュール
 * 
 * Stage 6: 親予定と子予定のマージ機能（目玉機能）
 */

const Merger = {
  MERGED_TAG: '<マージ済み>',
  
  /**
   * マージ対象の予定を検出
   * @param {string} date - 対象日付 (YYYY-MM-DD)
   * @returns {Object} マージ情報
   */
  detectMergeCandidates(date) {
    GRMLogger.info('Stage6', 'マージ候補検出開始', { date });
    
    const parent = GRMCalendar.findParentEvent(date);
    const children = GRMCalendar.findChildEvents(date);
    
    // マージ済みを除外
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
    
    GRMLogger.info('Stage6', 'マージ候補検出完了', {
      hasParent: result.hasParent,
      childCount: unmergedChildren.length,
      canMerge: result.canMerge
    });
    
    return result;
  },

  /**
   * 今後の予約に対するマージ候補を全て検出
   * @returns {Array<Object>} マージ候補リスト
   */
  detectAllMergeCandidates() {
    GRMLogger.info('Stage6', '全マージ候補検出開始');
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dbSheet = ss.getSheetByName(Config.SHEET_NAMES.RESERVATION_DB);
    
    if (!dbSheet) {
      return [];
    }
    
    const data = dbSheet.getDataRange().getValues();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const candidates = [];
    
    // ヘッダー行をスキップ
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const dateStr = row[2]; // 予約日
      const status = row[6];  // ステータス
      
      if (status === 'cancelled') continue;
      
      const reservationDate = new Date(dateStr);
      if (reservationDate < today) continue;
      
      const mergeInfo = this.detectMergeCandidates(dateStr);
      if (mergeInfo.canMerge) {
        mergeInfo.reservationId = row[0];
        candidates.push(mergeInfo);
      }
    }
    
    GRMLogger.info('Stage6', '全マージ候補検出完了', { 
      candidateCount: candidates.length 
    });
    
    return candidates;
  },

  /**
   * マージを実行
   * @param {string} date - 対象日付
   * @returns {Object} マージ結果
   */
  executeMerge(date) {
    GRMLogger.info('Stage6', 'マージ実行開始', { date });
    
    try {
      const mergeInfo = this.detectMergeCandidates(date);
      
      if (!mergeInfo.canMerge) {
        GRMLogger.warn('Stage6', 'マージ対象なし', { date });
        return { success: false, message: 'マージ対象がありません' };
      }
      
      const parent = mergeInfo.parent;
      const children = mergeInfo.children;
      
      // 1. 子予定のメモを収集
      const childNotes = children.map(child => {
        return `\n【${child.title}】\n${child.description || '(メモなし)'}`;
      }).join('\n');
      
      // 2. 親予定の説明文を更新
      const newDescription = `${parent.description}

--- マージされたメモ (${new Date().toLocaleString('ja-JP')}) ---
${childNotes}`;
      
      parent.event.setDescription(newDescription);
      
      // 3. 子予定のタイトルを更新
      const calendarId = Config.get('CALENDAR_ID');
      const calendar = CalendarApp.getCalendarById(calendarId);
      
      children.forEach(child => {
        const childEvent = calendar.getEventById(child.id);
        if (childEvent) {
          const newTitle = `${this.MERGED_TAG} ${child.title}`;
          childEvent.setTitle(newTitle);
        }
      });
      
      // 4. マージログを記録
      this.logMerge(date, parent, children);
      
      GRMLogger.info('Stage6', 'マージ実行完了', { 
        date,
        mergedCount: children.length
      });
      
      GRMLogger.logTransaction('Stage6', 'MERGE', parent.id, 'success', {
        date,
        childCount: children.length,
        childIds: children.map(c => c.id)
      });
      
      return {
        success: true,
        message: `${children.length}件の子予定をマージしました`,
        mergedCount: children.length
      };
      
    } catch (e) {
      GRMLogger.error('Stage6', 'マージ実行エラー', { 
        date,
        error: e.message 
      });
      return { success: false, message: e.message };
    }
  },

  /**
   * マージログを記録
   */
  logMerge(date, parent, children) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let logSheet = ss.getSheetByName(Config.SHEET_NAMES.MERGE_LOG);
      
      if (!logSheet) {
        logSheet = ss.insertSheet(Config.SHEET_NAMES.MERGE_LOG);
        logSheet.getRange('A1:F1').setValues([[
          'MergeID', 'Date', 'ParentEventID', 'ChildEventIDs', 'MergedAt', 'ChildCount'
        ]]);
        logSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#4a4a4a');
      }
      
      const mergeId = Utilities.getUuid();
      const childIds = children.map(c => c.id).join(',');
      
      logSheet.appendRow([
        mergeId,
        date,
        parent.id,
        childIds,
        new Date().toISOString(),
        children.length
      ]);
      
    } catch (e) {
      GRMLogger.warn('Stage6', 'マージログ記録エラー', { error: e.message });
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
      
      // 新しい順に取得（ヘッダー行をスキップ）
      for (let i = data.length - 1; i >= 1 && history.length < limit; i--) {
        const row = data[i];
        history.push({
          mergeId: row[0],
          date: row[1],
          parentEventId: row[2],
          childEventIds: row[3].split(','),
          mergedAt: row[4],
          childCount: row[5]
        });
      }
      
      return history;
      
    } catch (e) {
      GRMLogger.error('Stage6', 'マージ履歴取得エラー', { error: e.message });
      return [];
    }
  },

  /**
   * 全マージ待ちを一括実行
   */
  executeAllMerges() {
    GRMLogger.info('Stage6', '一括マージ開始');
    
    const candidates = this.detectAllMergeCandidates();
    const results = [];
    
    candidates.forEach(candidate => {
      const result = this.executeMerge(candidate.date);
      results.push({
        date: candidate.date,
        ...result
      });
    });
    
    const successCount = results.filter(r => r.success).length;
    
    GRMLogger.info('Stage6', '一括マージ完了', { 
      total: candidates.length,
      success: successCount
    });
    
    return {
      total: candidates.length,
      success: successCount,
      results
    };
  }
};

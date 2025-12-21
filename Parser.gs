/**
 * Golf Reservation Manager (GRM) - Parser
 * メール解析モジュール（辞書＋AIハイブリッド）
 * 
 * Stage 2: メールから予約情報を抽出してDBに格納
 */

const Parser = {
  /**
   * メール本文を解析して予約情報を抽出
   * @param {string} emailBody - メール本文
   * @returns {Array<Object>} 予約情報の配列
   */
  parseEmail(emailBody) {
    GRMLogger.info('Stage2', 'メール解析開始', { bodyLength: emailBody.length });
    
    // 1. 辞書ベースの解析を試行
    let results = this.parseWithDictionary(emailBody);
    let confidence = this.calculateConfidence(results);
    
    GRMLogger.debug('Stage2', '辞書解析結果', { 
      resultCount: results.length, 
      confidence 
    });
    
    // 2. 信頼度が低い場合はAI APIで解析
    if (confidence < 0.7 && Config.get('AI_API_KEY')) {
      GRMLogger.info('Stage2', 'AI解析にフォールバック', { confidence });
      const aiResults = this.parseWithAI(emailBody);
      
      if (aiResults && aiResults.length > 0) {
        results = this.mergeResults(results, aiResults);
        
        // AI結果を辞書にフィードバック
        this.feedbackToDictionary(emailBody, aiResults);
      }
    }
    
    // 3. 信頼度フラグを設定
    results.forEach(r => {
      r.needsReview = confidence < 0.8;
      r.confidence = confidence;
    });
    
    GRMLogger.info('Stage2', 'メール解析完了', { 
      resultCount: results.length,
      needsReview: confidence < 0.8
    });
    
    return results;
  },

  /**
   * 辞書ベースの解析（正規表現）
   */
  parseWithDictionary(text) {
    const results = [];
    
    // 正規化（全角→半角、スペース統一）
    const normalizedText = this.normalizeText(text);
    
    // 日付パターン
    const datePatterns = [
      /(\d{1,2})月\s*(\d{1,2})日[（(]([月火水木金土日])[)）]/g,
      /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日]?/g
    ];
    
    // コースパターン
    const coursePattern = /(OUT|IN|アウト|イン)(?:コース)?/gi;
    
    // 時間パターン
    const timePatterns = [
      /(\d{1,2})[時:](\d{2})(?:分)?(?:\s*スタート)?/g,
      /(\d{1,2})時(\d{2})分/g,
      /(\d{1,2}):(\d{2})/g
    ];

    // 日付を抽出
    let dateMatch;
    datePatterns.forEach(pattern => {
      while ((dateMatch = pattern.exec(normalizedText)) !== null) {
        const reservation = {
          month: parseInt(dateMatch[1]),
          day: parseInt(dateMatch[2]),
          weekday: dateMatch[3] || null,
          course: null,
          hour: null,
          minute: null,
          rawText: dateMatch[0]
        };
        
        // 日付の後ろの文脈からコースと時間を探す
        const contextStart = dateMatch.index;
        const contextEnd = Math.min(contextStart + 100, normalizedText.length);
        const context = normalizedText.substring(contextStart, contextEnd);
        
        // コース抽出
        const courseMatch = context.match(coursePattern);
        if (courseMatch) {
          reservation.course = courseMatch[0].toUpperCase().includes('OUT') ? 'OUT' : 'IN';
        }
        
        // 時間抽出
        timePatterns.forEach(timePattern => {
          const timeMatch = context.match(timePattern);
          if (timeMatch && !reservation.hour) {
            reservation.hour = parseInt(timeMatch[1]);
            reservation.minute = parseInt(timeMatch[2]);
          }
        });
        
        if (reservation.hour) {
          results.push(reservation);
        }
      }
    });
    
    return results;
  },

  /**
   * テキスト正規化
   */
  normalizeText(text) {
    return text
      // 全角英数→半角
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => 
        String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      // 全角スペース→半角
      .replace(/　/g, ' ')
      // 複数スペース→単一
      .replace(/\s+/g, ' ')
      // 全角コロン→半角
      .replace(/：/g, ':');
  },

  /**
   * AI APIで解析
   */
  parseWithAI(emailBody) {
    try {
      const apiKey = Config.get('AI_API_KEY');
      if (!apiKey) return null;
      
      const prompt = `
以下のゴルフ場からのメールから予約情報を抽出してください。
JSON形式で、以下のフィールドを含む配列で返してください：
- month: 月（数値）
- day: 日（数値）
- weekday: 曜日（漢字1文字）
- course: コース（"OUT"または"IN"）
- hour: 時（数値）
- minute: 分（数値）

メール本文:
${emailBody}

JSONのみを返してください。説明は不要です。
      `.trim();
      
      const response = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + apiKey,
        {
          method: 'POST',
          contentType: 'application/json',
          payload: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );
      
      const result = JSON.parse(response.getContentText());
      const aiText = result.candidates[0].content.parts[0].text;
      
      // JSONを抽出
      const jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return null;
    } catch (e) {
      GRMLogger.error('Stage2', 'AI解析エラー', { error: e.message });
      return null;
    }
  },

  /**
   * 信頼度を計算
   */
  calculateConfidence(results) {
    if (results.length === 0) return 0;
    
    let score = 0;
    results.forEach(r => {
      if (r.month && r.day) score += 0.3;
      if (r.hour && r.minute !== undefined) score += 0.3;
      if (r.course) score += 0.2;
      if (r.weekday) score += 0.2;
    });
    
    return score / results.length;
  },

  /**
   * 結果をマージ
   */
  mergeResults(dictResults, aiResults) {
    // AI結果を優先しつつ、辞書結果で補完
    if (aiResults.length > 0) {
      return aiResults.map((ai, i) => ({
        ...ai,
        ...dictResults[i], // 辞書結果で上書き
        ...ai // AI結果を最終的に優先
      }));
    }
    return dictResults;
  },

  /**
   * AI結果を辞書にフィードバック
   */
  feedbackToDictionary(emailBody, results) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let dictSheet = ss.getSheetByName(Config.SHEET_NAMES.DICTIONARY);
      
      if (!dictSheet) {
        dictSheet = ss.insertSheet(Config.SHEET_NAMES.DICTIONARY);
        dictSheet.getRange('A1:D1').setValues([
          ['Pattern', 'ExtractedValue', 'FieldType', 'AddedAt']
        ]);
        dictSheet.getRange('A1:D1').setFontWeight('bold');
      }
      
      // 将来的にパターンを学習・蓄積
      GRMLogger.info('Stage2', '辞書へのフィードバック記録', { 
        resultCount: results.length 
      });
    } catch (e) {
      GRMLogger.warn('Stage2', '辞書フィードバックエラー', { error: e.message });
    }
  },

  /**
   * 解析結果をDBに保存
   */
  saveToDatabase(reservations, emailMessageId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let dbSheet = ss.getSheetByName(Config.SHEET_NAMES.RESERVATION_DB);
    
    if (!dbSheet) {
      dbSheet = this.initReservationDB(ss);
    }
    
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();
    
    reservations.forEach(res => {
      // 年を推定（4ヶ月先なので現在年または翌年）
      let year = currentYear;
      const currentMonth = new Date().getMonth() + 1;
      if (res.month < currentMonth) {
        year = currentYear + 1;
      }
      
      const dateStr = `${year}-${String(res.month).padStart(2, '0')}-${String(res.day).padStart(2, '0')}`;
      const timeStr = `${String(res.hour).padStart(2, '0')}:${String(res.minute).padStart(2, '0')}`;
      
      const id = Utilities.getUuid();
      
      dbSheet.appendRow([
        id,                          // ID
        now.split('T')[0],          // メール受信日
        dateStr,                     // 予約日
        res.weekday || '',          // 曜日
        res.course || 'OUT',        // コース
        timeStr,                     // 時間
        res.needsReview ? 'pending' : 'confirmed', // ステータス
        '',                          // カレンダーEventID
        now,                         // 最終更新日時
        res.confidence || 0,        // 信頼度
        emailMessageId || ''        // メールID
      ]);
      
      GRMLogger.logTransaction('Stage2', 'CREATE', id, 'pending', {
        date: dateStr,
        time: timeStr,
        course: res.course
      });
    });
    
    return reservations.length;
  },

  /**
   * 予約DBシートの初期化
   */
  initReservationDB(ss) {
    const dbSheet = ss.insertSheet(Config.SHEET_NAMES.RESERVATION_DB);
    dbSheet.getRange('A1:K1').setValues([[
      'ID', 'メール受信日', '予約日', '曜日', 'コース', '時間',
      'ステータス', 'カレンダーEventID', '最終更新日時', '信頼度', 'メールID'
    ]]);
    dbSheet.getRange('A1:K1').setFontWeight('bold').setBackground('#4a4a4a');
    dbSheet.setFrozenRows(1);
    return dbSheet;
  }
};

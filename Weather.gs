/**
 * Golf Reservation Manager (GRM) - Weather
 * 天気API連携モジュール
 * 
 * Stage 5: リマインダー通知時に天気情報を表示
 */

const Weather = {
  /**
   * 天気情報を取得
   * @param {string} date - 対象日付 (YYYY-MM-DD)
   * @returns {Object} 天気情報
   */
  getWeatherForecast(date) {
    GRMLogger.info('Weather', '天気情報取得開始', { date });
    
    try {
      const apiKey = Config.get('WEATHER_API_KEY');
      const lat = Config.get('GOLF_CLUB_LAT') || '35.7796';
      const lon = Config.get('GOLF_CLUB_LON') || '140.3126';
      
      // APIキーがない場合はモックデータを返す
      if (!apiKey) {
        GRMLogger.warn('Weather', 'APIキーなし、モックデータを使用');
        return this.getMockWeather(date);
      }
      
      // OpenWeatherMap API
      const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=ja`;
      
      const response = UrlFetchApp.fetch(url);
      const data = JSON.parse(response.getContentText());
      
      // 対象日のデータを抽出
      const targetDate = new Date(date);
      const forecastData = this.findForecastForDate(data.list, targetDate);
      
      if (forecastData) {
        return {
          date: date,
          condition: this.mapCondition(forecastData.weather[0].main),
          description: forecastData.weather[0].description,
          temp: Math.round(forecastData.main.temp),
          tempMin: Math.round(forecastData.main.temp_min),
          tempMax: Math.round(forecastData.main.temp_max),
          humidity: forecastData.main.humidity,
          wind: Math.round(forecastData.wind.speed),
          rainChance: forecastData.pop ? Math.round(forecastData.pop * 100) : 0,
          icon: forecastData.weather[0].icon
        };
      }
      
      // 予報範囲外の場合はモックを返す
      return this.getMockWeather(date);
      
    } catch (e) {
      GRMLogger.error('Weather', '天気情報取得エラー', { error: e.message });
      return this.getMockWeather(date);
    }
  },

  /**
   * 予報リストから対象日のデータを探す
   */
  findForecastForDate(forecastList, targetDate) {
    const targetDateStr = targetDate.toISOString().split('T')[0];
    
    // 朝8時頃のデータを優先（ゴルフの時間帯）
    for (const forecast of forecastList) {
      const forecastDate = new Date(forecast.dt * 1000);
      const forecastDateStr = forecastDate.toISOString().split('T')[0];
      
      if (forecastDateStr === targetDateStr) {
        const hour = forecastDate.getHours();
        if (hour >= 6 && hour <= 12) {
          return forecast;
        }
      }
    }
    
    // 見つからない場合は該当日の最初のデータを返す
    for (const forecast of forecastList) {
      const forecastDate = new Date(forecast.dt * 1000);
      const forecastDateStr = forecastDate.toISOString().split('T')[0];
      
      if (forecastDateStr === targetDateStr) {
        return forecast;
      }
    }
    
    return null;
  },

  /**
   * 天気状態をマッピング
   */
  mapCondition(weatherMain) {
    const conditionMap = {
      'Clear': 'sunny',
      'Clouds': 'cloudy',
      'Rain': 'rainy',
      'Drizzle': 'rainy',
      'Thunderstorm': 'rainy',
      'Snow': 'snowy',
      'Mist': 'cloudy',
      'Fog': 'cloudy'
    };
    return conditionMap[weatherMain] || 'cloudy';
  },

  /**
   * モック天気データ
   */
  getMockWeather(date) {
    const targetDate = new Date(date);
    const seed = targetDate.getDate() % 4;
    
    const conditions = ['sunny', 'cloudy', 'partlyCloudy', 'rainy'];
    const descriptions = ['晴れ', '曇り', '晴れ時々曇り', '雨'];
    
    return {
      date: date,
      condition: conditions[seed],
      description: descriptions[seed],
      temp: 15 + (seed * 3),
      tempMin: 10 + (seed * 2),
      tempMax: 20 + (seed * 3),
      humidity: [45, 60, 55, 85][seed],
      wind: [2, 4, 3, 6][seed],
      rainChance: [10, 30, 20, 80][seed],
      icon: '01d',
      isMock: true
    };
  },

  /**
   * ゴルフに適した天気かどうかを判定
   */
  isGoodForGolf(weather) {
    // 雨の確率が50%以上、または風速が10m/s以上は不適
    if (weather.rainChance >= 50) return false;
    if (weather.wind >= 10) return false;
    if (weather.condition === 'rainy') return false;
    
    return true;
  },

  /**
   * 天気情報をフォーマット（通知用）
   */
  formatForNotification(weather) {
    const conditionEmoji = {
      'sunny': '☀️',
      'cloudy': '☁️',
      'partlyCloudy': '⛅',
      'rainy': '🌧️',
      'snowy': '❄️'
    };
    
    const emoji = conditionEmoji[weather.condition] || '🌤️';
    const goodForGolf = this.isGoodForGolf(weather);
    const recommendation = goodForGolf 
      ? '✅ ゴルフ日和です！' 
      : '⚠️ 天候にご注意ください';
    
    return `
${emoji} ${weather.description}
気温: ${weather.temp}°C
降水確率: ${weather.rainChance}%
風速: ${weather.wind}m/s
湿度: ${weather.humidity}%

${recommendation}
    `.trim();
  }
};

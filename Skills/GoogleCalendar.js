const fs = require('node:fs');
const path = require('node:path');

// Helper to get credentials
const getAuthToken = () => {
  // We look for a token in Settings/google_calendar.json or env
  try {
    const configPath = path.join(__dirname, '..', 'Settings', 'google_calendar.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.accessToken) return config.accessToken;
    }
  } catch (e) {
    /* ignore missing config */
  }
  return process.env.GOOGLE_CALENDAR_TOKEN;
};

const implementations = {
  list_calendar_events: async (
    { calendarId = 'primary', timeMin, maxResults = 10 },
    _permissions,
  ) => {
    const token = getAuthToken();
    if (!token)
      return 'Error: Google Calendar Access Token missing. Please configure Settings/google_calendar.json';

    let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=${maxResults}`;
    if (timeMin) url += `&timeMin=${encodeURIComponent(timeMin)}`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const error = await response.json();
        return `Error from Google API: ${error.error?.message || response.statusText}`;
      }

      const data = await response.json();
      if (!data.items || data.items.length === 0) return 'No upcoming events found.';

      return data.items
        .map((item) => `- ${item.summary} (${item.start.dateTime || item.start.date})`)
        .join('\n');
    } catch (e) {
      return `Error calling Google Calendar API: ${e.message}`;
    }
  },

  create_calendar_event: async (
    { calendarId = 'primary', summary, description, start, end },
    _permissions,
  ) => {
    const token = getAuthToken();
    if (!token) return 'Error: Google Calendar Access Token missing.';

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary,
          description,
          start: { dateTime: start },
          end: { dateTime: end },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return `Error creating event: ${error.error?.message || response.statusText}`;
      }

      const data = await response.json();
      return `Event created successfully: ${data.htmlLink}`;
    } catch (e) {
      return `Error creating Google Calendar event: ${e.message}`;
    }
  },
};

module.exports = { implementations };

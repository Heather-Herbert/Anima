const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const { implementations } = require('./GoogleCalendar');

jest.mock('node:fs');
jest.mock('fs', () => require('node:fs'));

describe('GoogleCalendar Skill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    process.env.GOOGLE_CALENDAR_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete global.fetch;
    delete process.env.GOOGLE_CALENDAR_TOKEN;
  });

  describe('list_calendar_events', () => {
    it('successfully lists events', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { summary: 'Meeting 1', start: { dateTime: '2026-03-14T10:00:00Z' } },
            { summary: 'Meeting 2', start: { date: '2026-03-15' } },
          ],
        }),
      });

      const result = await implementations.list_calendar_events({ maxResults: 2 }, {});
      expect(result).toContain('Meeting 1 (2026-03-14T10:00:00Z)');
      expect(result).toContain('Meeting 2 (2026-03-15)');
    });

    it('handles no events found', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

      const result = await implementations.list_calendar_events({}, {});
      expect(result).toBe('No upcoming events found.');
    });

    it('handles missing token', async () => {
      delete process.env.GOOGLE_CALENDAR_TOKEN;
      fs.existsSync.mockReturnValue(false);

      const result = await implementations.list_calendar_events({}, {});
      expect(result).toContain('Google Calendar Access Token missing');
    });

    it('handles API errors', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ error: { message: 'Unauthorized access' } }),
      });

      const result = await implementations.list_calendar_events({}, {});
      expect(result).toContain('Error from Google API: Unauthorized access');
    });
  });

  describe('create_calendar_event', () => {
    it('successfully creates an event', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ htmlLink: 'https://calendar.google.com/event' }),
      });

      const result = await implementations.create_calendar_event(
        {
          summary: 'New Event',
          start: '2026-03-14T12:00:00Z',
          end: '2026-03-14T13:00:00Z',
        },
        {},
      );

      expect(result).toContain('Event created successfully');
      expect(result).toContain('https://calendar.google.com/event');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('events'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('New Event'),
        }),
      );
    });

    it('handles API errors during creation', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'Invalid time' } }),
      });

      const result = await implementations.create_calendar_event(
        {
          summary: 'New Event',
        },
        {},
      );

      expect(result).toContain('Error creating event: Invalid time');
    });
  });
});

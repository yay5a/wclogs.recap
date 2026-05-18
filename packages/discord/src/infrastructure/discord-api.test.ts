import { afterEach, describe, expect, it, vi } from 'vitest';
import { discordApiRequest } from './discord-api.js';

describe('discordApiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends JSON requests when no files are present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await discordApiRequest({
      endpoint: 'https://discord.test/webhook',
      method: 'POST',
      route: '/webhook',
      body: { content: 'hello' },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hello' });
  });

  it('sends multipart requests when files are present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'message-1' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    await discordApiRequest({
      endpoint: 'https://discord.test/webhook',
      method: 'POST',
      route: '/webhook',
      body: {
        content: 'https://www.warcraftlogs.com/reports/ABC123',
        flags: 64,
        files: [
          {
            name: 'report-summary.png',
            attachment: pngBytes,
            contentType: 'image/png',
            description: 'Raid report summary',
          },
        ],
      },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.body).toBeInstanceOf(FormData);

    const formData = init.body as FormData;
    expect(JSON.parse(formData.get('payload_json') as string)).toEqual({
      content: 'https://www.warcraftlogs.com/reports/ABC123',
      flags: 64,
      attachments: [
        {
          id: 0,
          filename: 'report-summary.png',
          description: 'Raid report summary',
        },
      ],
    });

    const file = formData.get('files[0]') as File;
    expect(file.name).toBe('report-summary.png');
    expect(file.type).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pngBytes);
  });
});

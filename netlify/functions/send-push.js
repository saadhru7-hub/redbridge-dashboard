// Netlify Function — sends a real push notification to a person's
// subscribed device(s). Called either directly by the app (e.g. when
// a teacher replies to a parent) or by a Supabase Database Webhook
// (for events that need to fire even when nobody has the app open).

const webpush = require('web-push');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey || !supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not fully configured yet.' }) };
  }

  webpush.setVapidDetails('mailto:admin@redbridge.school', vapidPublicKey, vapidPrivateKey);

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { owner_type, owner_id, title, body, url } = payload;
  if (!owner_type || !owner_id || !title) {
    return { statusCode: 400, body: JSON.stringify({ error: 'owner_type, owner_id, and title are required' }) };
  }

  try {
    const res = await fetch(
      supabaseUrl + '/rest/v1/push_subscriptions?owner_type=eq.' + encodeURIComponent(owner_type) +
        '&owner_id=eq.' + encodeURIComponent(owner_id) + '&select=id,subscription',
      { headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey } }
    );
    const subs = await res.json();

    if (!subs || !subs.length) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0, message: 'No subscribed devices for this person.' }) };
    }

    const notifPayload = JSON.stringify({ title, body: body || '', url: url || '/' });
    let sent = 0;
    const deadSubIds = [];

    await Promise.all(subs.map(async function (row) {
      try {
        await webpush.sendNotification(row.subscription, notifPayload);
        sent++;
      } catch (err) {
        // 404/410 means the subscription is no longer valid (device
        // unsubscribed, browser data cleared, etc.) — clean it up.
        if (err.statusCode === 404 || err.statusCode === 410) deadSubIds.push(row.id);
      }
    }));

    if (deadSubIds.length) {
      await fetch(supabaseUrl + '/rest/v1/push_subscriptions?id=in.(' + deadSubIds.join(',') + ')', {
        method: 'DELETE',
        headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey }
      }).catch(function () {});
    }

    return { statusCode: 200, body: JSON.stringify({ sent: sent, cleaned_up: deadSubIds.length }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send: ' + err.message }) };
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  const token     = process.env.CF_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID;

  if (!token || !accountId) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    // Get zone ID
    const zonesRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&name=andrewdaugdaug.com`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const zonesData = await zonesRes.json();
    const zoneId = zonesData.result?.[0]?.id;
    if (!zoneId) throw new Error('Zone not found');

    // Date range: last 30 days
    const until = new Date().toISOString().split('T')[0];
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // GraphQL query for visits + top countries
    const gql = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `{
          viewer {
            zones(filter: { zoneTag: "${zoneId}" }) {
              total: httpRequestsAdaptiveGroups(
                limit: 1
                filter: { datetime_geq: "${since}T00:00:00Z", datetime_leq: "${until}T23:59:59Z" }
              ) {
                sum { pageViews }
                count
              }
              countries: httpRequestsAdaptiveGroups(
                limit: 10
                filter: { datetime_geq: "${since}T00:00:00Z", datetime_leq: "${until}T23:59:59Z" }
                orderBy: [count_DESC]
              ) {
                count
                dimensions { clientCountryName }
              }
            }
          }
        }`,
      }),
    });

    const gqlData = await gql.json();
    const zone = gqlData.data?.viewer?.zones?.[0];

    const pageViews = zone?.total?.[0]?.sum?.pageViews || 0;
    const requests  = zone?.total?.[0]?.count || 0;
    const countries = (zone?.countries || [])
      .filter(c => c.dimensions?.clientCountryName)
      .map(c => ({ country: c.dimensions.clientCountryName, count: c.count }));

    res.status(200).json({ pageViews, requests, countries, since, until });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

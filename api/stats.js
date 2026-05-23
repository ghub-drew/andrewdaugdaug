export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  const token     = process.env.CF_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID;

  if (!token || !accountId) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    // First, get the Web Analytics site tag for andrewdaugdaug.com
    const sitesRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/rum/site_info/list`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const sitesData = await sitesRes.json();
    const site = sitesData.result?.find(s => s.host === 'www.andrewdaugdaug.com' || s.host === 'andrewdaugdaug.com');
    const siteTag = site?.tag || site?.site_tag;

    // Date range: last 30 days
    const until = new Date().toISOString().split('T')[0];
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Query RUM (Web Analytics) data via GraphQL
    const gql = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `{
          viewer {
            accounts(filter: { accountTag: "${accountId}" }) {
              total: rumPageloadEventsAdaptiveGroups(
                limit: 1
                filter: {
                  datetime_geq: "${since}T00:00:00Z"
                  datetime_leq: "${until}T23:59:59Z"
                  ${siteTag ? `siteTag: "${siteTag}"` : ''}
                }
              ) {
                count
                sum { visits }
              }
              countries: rumPageloadEventsAdaptiveGroups(
                limit: 10
                filter: {
                  datetime_geq: "${since}T00:00:00Z"
                  datetime_leq: "${until}T23:59:59Z"
                  ${siteTag ? `siteTag: "${siteTag}"` : ''}
                }
                orderBy: [count_DESC]
              ) {
                count
                dimensions { countryName }
              }
            }
          }
        }`,
      }),
    });

    const gqlData = await gql.json();
    const account = gqlData.data?.viewer?.accounts?.[0];

    const pageViews = account?.total?.[0]?.count || 0;
    const visits    = account?.total?.[0]?.sum?.visits || 0;
    const countries = (account?.countries || [])
      .filter(c => c.dimensions?.countryName)
      .map(c => ({ country: c.dimensions.countryName, count: c.count }));

    res.status(200).json({
      pageViews,
      requests: visits,
      countries,
      since,
      until,
      siteTag: siteTag || 'not found',
      debug: !account ? gqlData : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

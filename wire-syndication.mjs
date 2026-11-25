// A syndicated feed is a discovery index. Its crawl times never establish original release times.
export async function syndicatedIndex(feed,at,fetcher=fetch) {
  const stream='feed/'+feed.url;
  const endpoint=new URL('https://cloud.feedly.com/v3/streams/contents');
  endpoint.searchParams.set('streamId',stream);endpoint.searchParams.set('count','100');
  const response=await fetcher(endpoint.href,{headers:{'User-Agent':'TickerDocket public filings monitor newsletter@tickerdocket.com'},signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Error('Syndicated feed HTTP '+response.status);
  const data=await response.json();
  if (data.id!==stream || !Array.isArray(data.items)) throw Error('Syndicated stream identity mismatch');
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const items=[];
  for(const item of data.items) {
    if (item.origin?.streamId!==stream || typeof item.title!=='string' || !Number.isFinite(item.crawled) || item.crawled>at || item.crawled<at-7*86400000) continue;
    const links=[item.canonicalUrl,...(item.canonical||[]).map(x=>x.href),...(item.alternate||[]).map(x=>x.href)];
    const url=links.find(x=>typeof x==='string' && /^https:\/\/www\.globenewswire\.com\/(?:[a-z]{2}\/)?news-release\//i.test(x));
    if (!url) continue;
    items.push('<item><title>'+esc(item.title)+'</title><link>'+esc(url)+'</link><pubDate>'+new Date(item.crawled).toUTCString()+'</pubDate></item>');
  }
  if (!items.length || !Number.isFinite(data.updated) || data.updated>at+30000) throw Error('Syndicated index contains no recent attributable releases');
  return {body:'<rss version="2.0"><channel>'+items.join('')+'</channel></rss>',via:'syndicated index',url:feed.url,
    origin_updated_at:new Date(data.updated).toISOString(),fetched_at:new Date(at).toISOString(),endpoint:endpoint.href};
}

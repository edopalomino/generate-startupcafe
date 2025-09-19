// config.js
export const RSS_FEEDS = [
  'https://www.forbes.com.mx/emprendedores/feed/',
  'https://contxto.com/es/feed/',
  'https://platzi.com/blog/feed/',
  'https://endeavor.org.mx/feed/',
  'https://www.entrepreneur.com/es/rss',
  'https://techcrunch.com/category/startups/feed/',
  'https://www.geekwire.com/startups/feed/',
  'http://feeds.feedburner.com/ElBlogDeJavierMegiasTerol',
  'https://blog.ycombinator.com/feed/',
  'https://www.forbes.com/innovation/feed/',
];

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const CLOUDINARY_CONFIG = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
};

export const MASTODON_CONFIG = {
  url: process.env.MASTODON_URL,
  accessToken: process.env.MASTODON_TOKEN,
};

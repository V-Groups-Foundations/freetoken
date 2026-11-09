import type { MetadataRoute } from 'next';

// "Add to Home Screen" on a phone: FreeToken opens full screen like an app, on the page made for it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FreeToken',
    short_name: 'FreeToken',
    description: 'Free AI models: chat, images, a diet coach and more.',
    start_url: '/diet',
    display: 'standalone',
    background_color: '#070b16',
    theme_color: '#070b16',
    icons: [{ src: '/brand/freetoken.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  };
}

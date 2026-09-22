import { useEffect, useState, type ReactNode } from 'react';

/** 轻量 hash 路由（不引第三方依赖）：#/building/:id、#/floor/:id、#/floor/:id/print ... */
export function currentPath(): string {
  const h = window.location.hash;
  if (!h.startsWith('#')) return '/';
  return h.slice(1) || '/';
}

export function navigate(to: string) {
  if (currentPath() === to) return;
  window.location.hash = `#${to}`;
}

export function useRoute(): { path: string; parts: string[] } {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return { path, parts: path.split('/').filter(Boolean) };
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

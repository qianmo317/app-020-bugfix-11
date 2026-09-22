import { FloorEditor } from './pages/FloorEditor';
import { Home } from './pages/Home';
import { BuildingPage } from './pages/Building';
import { PrintPage } from './pages/Print';
import { FacilitiesPage } from './pages/Facilities';
import { RulesPage } from './pages/Rules';
import { Link, useRoute } from './router';

export function App() {
  const { parts } = useRoute();
  const [seg0, seg1, seg2] = parts;

  let content: React.ReactNode;
  if (!seg0) content = <Home />;
  else if (seg0 === 'building' && seg1) content = <BuildingPage buildingId={seg1} />;
  else if (seg0 === 'floor' && seg1 && seg2 === 'print') content = <PrintPage floorId={seg1} />;
  else if (seg0 === 'floor' && seg1) content = <FloorEditor floorId={seg1} />;
  else if (seg0 === 'facilities') content = <FacilitiesPage />;
  else if (seg0 === 'rules') content = <RulesPage />;
  else content = <div className="page">页面不存在。<Link to="/">返回首页</Link></div>;

  return (
    <div className="app">
      <nav className="topnav no-print">
        <Link to="/" className="brand">
          <span className="brandmark" /> 消防疏散图
        </Link>
        <Link to="/">建筑</Link>
        <Link to="/facilities">设施台账</Link>
        <Link to="/rules">规则</Link>
        <span className="hint" style={{ marginLeft: 'auto' }}>数据仅存于本机浏览器 · 断网可用</span>
      </nav>
      <main className="main">{content}</main>
    </div>
  );
}

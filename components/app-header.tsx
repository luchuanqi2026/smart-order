import Link from "next/link";
import { Bot, ChevronLeft, Database, FileSpreadsheet, ListChecks, Network, Settings2 } from "lucide-react";

type NavKey = "import" | "rules" | "model" | "orders" | "docs";

interface AppHeaderProps {
  active: NavKey;
  actions?: React.ReactNode;
}

const navItems: Array<{ key: NavKey; href: string; label: string; icon: React.ElementType }> = [
  { key: "import", href: "/import", label: "批量录单（新）", icon: FileSpreadsheet },
  { key: "rules", href: "/rules", label: "解析规则管理", icon: Settings2 },
  { key: "orders", href: "/orders", label: "订单管理", icon: ListChecks },
  { key: "model", href: "/model", label: "模型设置", icon: Bot },
  { key: "docs", href: "/docs", label: "技术说明", icon: Network }
];

export function AppHeader({ active, actions }: AppHeaderProps) {
  return (
    <header className="topbar">
      <button className="topbar-back" type="button" aria-label="返回">
        <ChevronLeft size={18} />
      </button>
      <div className="brand" aria-label="系统标题">
        <span className="brand-mark">
          <Database size={20} />
        </span>
        <span>
          <h1 className="brand-title">智能批量下单</h1>
          <p className="brand-subtitle">规则驱动解析引擎</p>
        </span>
      </div>
      <nav className="main-nav" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link className={`nav-link${active === item.key ? " active" : ""}`} href={item.href} key={item.key}>
              <Icon size={15} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}

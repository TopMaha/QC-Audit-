import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BrandMark } from '@/components/AppHeader';
import { SignInForm } from '@/components/SignInForm';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/hooks/useData';
import { useI18n } from '@/lib/i18n';

export default function AdminGate() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const { admin } = useSession();
  if (admin) return <Navigate to="/admin/settings" replace />;

  const done = () => {
    toast(t('auth.adminTitle'));
    navigate('/admin/settings');
  };

  return (
    <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-4">
      <Link
        to="/"
        className="focusable mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('common.back')}
      </Link>

      <div className="panel overflow-hidden">
        <div className="brand-bar h-[3px] w-full" />
        <div className="p-6">
          <div className="mb-1 flex items-center gap-2.5">
            <BrandMark className="h-3.5" />
            <h1 className="text-lg font-semibold">{t('auth.adminTitle')}</h1>
          </div>
          <p className="mb-5 text-[13px] text-muted-foreground">{t('admin.gateHint')}</p>
          <SignInForm kind="admin" onSuccess={done} />
        </div>
      </div>
    </div>
  );
}

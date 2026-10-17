import type { Metadata } from 'next';
import { Landing } from '@/components/landing';

export const metadata: Metadata = { title: 'The campus circle', description: 'Good things come around. Buy, sell, rent and share skills with your campus community on UniCirq.' };
export default function AboutPage() { return <Landing />; }

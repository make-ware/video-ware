'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import pb from '@/lib/pocketbase-client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  format,
  parseISO,
  startOfMonth,
  subMonths,
  isSameMonth,
} from 'date-fns';
import { Loader2, HardDrive, Cpu, Video, AlertTriangle } from 'lucide-react';
import type { UsageEvent as UsageEventRecord } from '@project/shared';
import type { File as FileRecord } from '@project/shared';
import type { Upload as UploadRecord } from '@project/shared';

export default function MetricsPage() {
  const params = useParams();
  const workspaceId = params?.workspaceId as string;

  const [loading, setLoading] = useState(true);
  const [gcviEvents, setGcviEvents] = useState<UsageEventRecord[]>([]);
  const [transcodeEvents, setTranscodeEvents] = useState<UsageEventRecord[]>(
    []
  );
  const [storageEvents, setStorageEvents] = useState<UsageEventRecord[]>([]);
  const [currentFiles, setCurrentFiles] = useState<FileRecord[]>([]);
  const [currentUploads, setCurrentUploads] = useState<UploadRecord[]>([]);

  useEffect(() => {
    async function fetchData() {
      if (!workspaceId) return;

      try {
        setLoading(true);

        // Fetch Usage Events
        // We fetch usage events for the last 12 months to prevent fetching full history.
        const oneYearAgo = subMonths(new Date(), 12);
        const filterDate = format(oneYearAgo, 'yyyy-MM-dd 00:00:00');

        const usageEvents = await pb
          .collection('UsageEvents')
          .getFullList<UsageEventRecord>({
            filter: `WorkspaceRef = "${workspaceId}" && created >= "${filterDate}"`,
            sort: 'created',
          });

        const gcvi = usageEvents.filter((e) => e.type === 'GOOGLE_VIDEO');
        const transcode = usageEvents.filter((e) => e.subtype === 'TRANSCODE');
        const storage = usageEvents.filter((e) => e.type === 'STORAGE');

        setGcviEvents(gcvi);
        setTranscodeEvents(transcode);
        setStorageEvents(storage);

        // Fetch Current Files and Uploads for "Total Footprint"
        // Note: For large collections, getFullList might be heavy.
        // Ideally we would have a summary endpoint, but we calculate client-side for now.
        const files = await pb.collection('Files').getFullList<FileRecord>({
          filter: `WorkspaceRef = "${workspaceId}"`,
          fields: 'size',
        });

        const uploads = await pb
          .collection('Uploads')
          .getFullList<UploadRecord>({
            filter: `WorkspaceRef = "${workspaceId}"`,
            fields: 'size',
          });

        setCurrentFiles(files);
        setCurrentUploads(uploads);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [workspaceId]);

  // Calculations
  const totalGcviMinutes = useMemo(() => {
    const seconds = gcviEvents.reduce(
      (acc, curr) => acc + (curr.value || 0),
      0
    );
    return Math.round(seconds / 60);
  }, [gcviEvents]);

  const currentMonthGcviMinutes = useMemo(() => {
    const now = new Date();
    const currentMonthEvents = gcviEvents.filter((e) =>
      isSameMonth(parseISO(e.created), now)
    );
    const seconds = currentMonthEvents.reduce(
      (acc, curr) => acc + (curr.value || 0),
      0
    );
    return Math.round(seconds / 60);
  }, [gcviEvents]);

  const totalTranscodeMinutes = useMemo(() => {
    const seconds = transcodeEvents.reduce(
      (acc, curr) => acc + (curr.value || 0),
      0
    );
    return Math.round(seconds / 60);
  }, [transcodeEvents]);

  const totalStorageBytes = useMemo(() => {
    const filesSize = currentFiles.reduce(
      (acc, curr) => acc + (curr.size || 0),
      0
    );
    const uploadsSize = currentUploads.reduce(
      (acc, curr) => acc + (curr.size || 0),
      0
    );
    return filesSize + uploadsSize;
  }, [currentFiles, currentUploads]);

  const totalStorageGB = (totalStorageBytes / (1024 * 1024 * 1024)).toFixed(2);

  // Chart Data Preparation
  const groupByMonth = (events: UsageEventRecord[], valueScale = 1) => {
    const grouped: Record<string, number> = {};

    events.forEach((e) => {
      const monthKey = format(startOfMonth(parseISO(e.created)), 'yyyy-MM');
      grouped[monthKey] = (grouped[monthKey] || 0) + (e.value || 0);
    });

    return Object.entries(grouped)
      .map(([month, val]) => ({
        month,
        label: format(parseISO(month + '-01'), 'MMM yyyy'),
        value: Math.round(val * valueScale * 100) / 100,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  };

  const gcviChartData = useMemo(
    () => groupByMonth(gcviEvents, 1 / 60),
    [gcviEvents]
  ); // Seconds to Minutes
  const transcodeChartData = useMemo(
    () => groupByMonth(transcodeEvents, 1 / 60),
    [transcodeEvents]
  ); // Seconds to Minutes
  const storageTrendChartData = useMemo(
    () => groupByMonth(storageEvents, 1 / (1024 * 1024 * 1024)),
    [storageEvents]
  ); // Bytes to GB

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workspace Metrics</h1>
        <p className="text-muted-foreground mt-2">
          Overview of resource usage, limits, and trends.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Google Cloud Video Intelligence
            </CardTitle>
            <Video className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {currentMonthGcviMinutes} min
            </div>
            <p className="text-xs text-muted-foreground">
              Current month usage (Total: {totalGcviMinutes} min)
            </p>
            {currentMonthGcviMinutes > 1000 && (
              <div className="mt-2 flex items-center text-xs text-destructive">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Over monthly limit (1000 min)
              </div>
            )}
            {currentMonthGcviMinutes <= 1000 && (
              <div className="mt-2 text-xs text-muted-foreground">
                Limit: 1000 min / month
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Transcode Compute
            </CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalTranscodeMinutes} min
            </div>
            <p className="text-xs text-muted-foreground">
              Total transcoding time
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Storage Footprint
            </CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStorageGB} GB</div>
            <p className="text-xs text-muted-foreground">
              Current files and uploads
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* GCVI Chart */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Label Usage Trend</CardTitle>
            <CardDescription>Monthly usage in minutes</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {gcviChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gcviChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Bar
                    dataKey="value"
                    name="Minutes"
                    fill="#8884d8"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transcode Chart */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Transcode Usage Trend</CardTitle>
            <CardDescription>Monthly usage in minutes</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {transcodeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={transcodeChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Bar
                    dataKey="value"
                    name="Minutes"
                    fill="#82ca9d"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Storage Added Chart */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>New Storage Trend</CardTitle>
            <CardDescription>GB added per month</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {storageTrendChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={storageTrendChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Bar
                    dataKey="value"
                    name="GB Added"
                    fill="#ffc658"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

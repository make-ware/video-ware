'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { usePocketBase } from '@/contexts/pocketbase-context';
import { LabelSpeech } from '@project/shared';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function LabelTranscriptsPage() {
  const { pb } = usePocketBase();
  const params = useParams();
  const mediaId = params.id as string;
  const [transcripts, setTranscripts] = useState<LabelSpeech[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTranscripts() {
      if (!mediaId) return;
      try {
        // Fetch all transcripts for this media
        const records = await pb
          .collection('LabelSpeech')
          .getFullList<LabelSpeech>({
            filter: `MediaRef = "${mediaId}"`,
            sort: 'start',
          });
        setTranscripts(records);
      } catch (err) {
        console.error(err);
        toast.error('Failed to load transcripts');
      } finally {
        setLoading(false);
      }
    }
    fetchTranscripts();
  }, [pb, mediaId]);

  const fullText = useMemo(() => {
    return transcripts.map((t) => t.transcript).join(' ');
  }, [transcripts]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fullText);
    toast.success('Transcript copied to clipboard');
  };

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-12rem)]">
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Transcripts</CardTitle>
            <CardDescription>
              {transcripts.length} speech segments found
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            <Copy className="h-4 w-4 mr-2" />
            Copy Full Text
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <Tabs defaultValue="list" className="h-full flex flex-col">
            <div className="px-6">
              <TabsList>
                <TabsTrigger value="list">Segments</TabsTrigger>
                <TabsTrigger value="raw">Raw Text</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="list" className="flex-1 overflow-hidden mt-2">
              <ScrollArea className="h-full">
                <div className="p-6 pt-0 space-y-4">
                  {transcripts.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No transcripts found.
                    </p>
                  ) : (
                    transcripts.map((t) => (
                      <div
                        key={t.id}
                        className="flex gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="text-xs font-mono text-muted-foreground whitespace-nowrap pt-1">
                          {new Date(t.start * 1000).toISOString().substr(14, 5)}{' '}
                          -{new Date(t.end * 1000).toISOString().substr(14, 5)}
                        </div>
                        <p className="text-sm leading-relaxed">
                          {t.transcript}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="raw" className="flex-1 overflow-hidden mt-2">
              <ScrollArea className="h-full">
                <div className="p-6 pt-0">
                  <div className="p-6 bg-muted/30 rounded-lg border whitespace-pre-wrap leading-relaxed">
                    {fullText || (
                      <span className="text-muted-foreground italic">
                        No transcript content available.
                      </span>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

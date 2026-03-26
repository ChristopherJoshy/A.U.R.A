import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import Header from '../../src/components/Header';
import Screen from '../../src/components/Screen';
import api from '../../src/services/api';
import { colors, fonts, spacing, radius } from '../../src/theme';
import { Ionicons } from '@expo/vector-icons';

interface JournalEntry {
    id: string;
    content: string;
    created_at: string;
    source?: string;
}

type EntryFilter = 'all' | 'notes' | 'conversations';

//------This Function handles the Parse Date Param---------
function parseDateParam(dateParam: string | string[] | undefined): Date {
    const raw = Array.isArray(dateParam) ? dateParam[0] : dateParam;
    if (!raw) {
        return new Date();
    }
    const parsed = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
        return new Date();
    }
    return parsed;
}

//------This Function handles the Is Same Day---------
function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

//------This Function handles the Get Entry Type---------
function getEntryType(entry: JournalEntry): Exclude<EntryFilter, 'all'> {
    return entry.source === 'aura_module' ? 'conversations' : 'notes';
}

//------This Function handles the Get Entry Meta---------
function getEntryMeta(type: Exclude<EntryFilter, 'all'>) {
    if (type === 'conversations') {
        return {
            label: 'Conversation',
            icon: 'chatbubble-ellipses-outline',
            textColor: colors.bg,
            bgColor: colors.primary,
        };
    }
    return {
        label: 'Note',
        icon: 'create-outline',
        textColor: colors.textSecondary,
        bgColor: colors.surface,
    };
}

//------This Function handles the Count Words---------
function countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) {
        return 0;
    }
    return trimmed.split(/\s+/).length;
}

//------This Function handles the Calendar Journal Screen---------
export default function CalendarJournalScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ date?: string | string[] }>();
    //------This Function handles the Selected Date---------
    const selectedDate = useMemo(() => parseDateParam(params.date), [params.date]);

    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<EntryFilter>('all');

    //------This Function handles the Load---------
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/journal/');
            setEntries(res.data || []);
        } catch (error) {
            console.error('[CalendarJournal] load failed', error);
            Alert.alert('Error', 'Could not load journal entries');
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    //------This Function handles the Day Entries---------
    const dayEntries = useMemo(() => {
        //------This Function handles the Filtered---------
        const filtered = entries.filter((entry) => isSameDay(new Date(entry.created_at), selectedDate));
        return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }, [entries, selectedDate]);

    //------This Function handles the Counts---------
    const counts = useMemo(() => {
        //------This Function handles the Notes---------
        const notes = dayEntries.filter((entry) => getEntryType(entry) === 'notes').length;
        const conversations = dayEntries.length - notes;
        return { notes, conversations };
    }, [dayEntries]);

    //------This Function handles the Word Count---------
    const wordCount = useMemo(() => (
        dayEntries.reduce((acc, entry) => acc + countWords(entry.content || ''), 0)
    ), [dayEntries]);

    //------This Function handles the Visible Entries---------
    const visibleEntries = useMemo(() => {
        if (filter === 'all') {
            return dayEntries;
        }
        return dayEntries.filter((entry) => getEntryType(entry) === filter);
    }, [dayEntries, filter]);

    return (
        <Screen safeArea={false}>
            <Header
                title="Journal"
                subtitle={selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                showBack
                centered
                onBackPress={() => router.back()}
                rightElement={
                    <TouchableOpacity style={s.headerAction} onPress={() => router.push('/(patient)/journal')}>
                        <Ionicons name="open-outline" size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                }
            />

            {loading ? (
                <View style={s.loadingWrap}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
                    <View style={s.heroCard}>
                        <View style={s.heroTop}>
                            <View>
                                <Text style={s.heroLabel}>Daily Reflection</Text>
                                <Text style={s.heroValue}>{dayEntries.length}</Text>
                                <Text style={s.heroSub}>entries for this date</Text>
                            </View>
                            <View style={s.heroBadge}>
                                <Text style={s.heroBadgeText}>{wordCount}</Text>
                                <Text style={s.heroBadgeLabel}>words</Text>
                            </View>
                        </View>

                        <View style={s.statsRow}>
                            <View style={s.statItem}>
                                <Text style={s.statValue}>{counts.notes}</Text>
                                <Text style={s.statLabel}>Notes</Text>
                            </View>
                            <View style={s.statDivider} />
                            <View style={s.statItem}>
                                <Text style={s.statValue}>{counts.conversations}</Text>
                                <Text style={s.statLabel}>Conversations</Text>
                            </View>
                            <View style={s.statDivider} />
                            <View style={s.statItem}>
                                <Text style={s.statValue}>{dayEntries.length}</Text>
                                <Text style={s.statLabel}>Total</Text>
                            </View>
                        </View>
                    </View>

                    {dayEntries.length > 0 && (
                        <View style={s.filtersRow}>
                            {([
                                { key: 'all', label: 'All', count: dayEntries.length },
                                { key: 'notes', label: 'Notes', count: counts.notes },
                                { key: 'conversations', label: 'Conversations', count: counts.conversations },
                            ] as Array<{ key: EntryFilter; label: string; count: number }>).map((item) => (
                                <TouchableOpacity
                                    key={item.key}
                                    style={[s.filterChip, filter === item.key && s.filterChipActive]}
                                    onPress={() => setFilter(item.key)}
                                    activeOpacity={0.85}
                                >
                                    <Text style={[s.filterChipText, filter === item.key && s.filterChipTextActive]}>{item.label}</Text>
                                    <View style={[s.filterCount, filter === item.key && s.filterCountActive]}>
                                        <Text style={[s.filterCountText, filter === item.key && s.filterCountTextActive]}>{item.count}</Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    {dayEntries.length === 0 ? (
                        <View style={s.emptyCard}>
                            <Ionicons name="book-outline" size={30} color={colors.textMuted} />
                            <Text style={s.emptyTitle}>No Entries Yet</Text>
                            <Text style={s.emptySub}>Capture a note or conversation to build your journal history.</Text>
                            <TouchableOpacity style={s.emptyAction} onPress={() => router.push('/(patient)/journal')} activeOpacity={0.9}>
                                <Ionicons name="create-outline" size={16} color={colors.bg} />
                                <Text style={s.emptyActionText}>Open Journal</Text>
                            </TouchableOpacity>
                        </View>
                    ) : visibleEntries.length === 0 ? (
                        <View style={s.emptyCard}>
                            <Ionicons name="filter-outline" size={28} color={colors.textMuted} />
                            <Text style={s.emptyTitle}>Nothing Here</Text>
                            <Text style={s.emptySub}>No entries match this filter.</Text>
                        </View>
                    ) : (
                        <View style={s.listWrap}>
                            {visibleEntries.map((entry) => {
                                const entryType = getEntryType(entry);
                                const meta = getEntryMeta(entryType);
                                const timeLabel = new Date(entry.created_at).toLocaleTimeString('en-US', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                });
                                const entryWords = countWords(entry.content || '');

                                return (
                                    <View key={entry.id} style={s.entryCard}>
                                        <View style={s.entryTop}>
                                            <View style={s.entryTimeWrap}>
                                                <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                                                <Text style={s.entryTime}>{timeLabel}</Text>
                                            </View>
                                            <View style={[s.entrySourcePill, { backgroundColor: meta.bgColor }]}>
                                                <Ionicons name={meta.icon as any} size={12} color={meta.textColor} />
                                                <Text style={[s.entrySourceText, { color: meta.textColor }]}>{meta.label}</Text>
                                            </View>
                                        </View>

                                        <Text style={s.entryText}>{entry.content?.trim() || 'No content available.'}</Text>

                                        <View style={s.entryFooter}>
                                            <View style={s.entryMetaChip}>
                                                <Ionicons name="text-outline" size={13} color={colors.textMuted} />
                                                <Text style={s.entryMetaText}>{entryWords} words</Text>
                                            </View>
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </ScrollView>
            )}
        </Screen>
    );
}

const s = StyleSheet.create({
    headerAction: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: spacing.xxl,
        gap: spacing.md,
    },
    heroCard: {
        backgroundColor: colors.bgSecondary,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.borderLight,
        padding: spacing.lg,
    },
    heroTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    heroLabel: {
        color: colors.textMuted,
        fontSize: fonts.sizes.xs,
        fontWeight: '600',
        letterSpacing: 1,
    },
    heroValue: {
        marginTop: spacing.xs,
        color: colors.textPrimary,
        fontSize: fonts.sizes.hero,
        fontWeight: '700',
        letterSpacing: -1,
    },
    heroSub: {
        color: colors.textSecondary,
        fontSize: fonts.sizes.sm,
    },
    heroBadge: {
        minWidth: 74,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
    },
    heroBadgeText: {
        color: colors.primary,
        fontSize: fonts.sizes.lg,
        fontWeight: '700',
    },
    heroBadgeLabel: {
        color: colors.textMuted,
        fontSize: 10,
        marginTop: 2,
    },
    statsRow: {
        marginTop: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.md,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statDivider: {
        width: 1,
        height: 24,
        backgroundColor: colors.border,
    },
    statValue: {
        color: colors.textPrimary,
        fontSize: fonts.sizes.lg,
        fontWeight: '600',
    },
    statLabel: {
        marginTop: 2,
        color: colors.textMuted,
        fontSize: fonts.sizes.xs,
    },
    filtersRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        backgroundColor: colors.bgSecondary,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.full,
        paddingVertical: 7,
        paddingHorizontal: spacing.md,
    },
    filterChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.surface,
    },
    filterChipText: {
        color: colors.textSecondary,
        fontSize: fonts.sizes.xs,
        fontWeight: '500',
    },
    filterChipTextActive: {
        color: colors.textPrimary,
        fontWeight: '600',
    },
    filterCount: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    filterCountActive: {
        backgroundColor: colors.primary,
    },
    filterCountText: {
        color: colors.textMuted,
        fontSize: 10,
        fontWeight: '600',
    },
    filterCountTextActive: {
        color: colors.bg,
    },
    emptyCard: {
        backgroundColor: colors.bgSecondary,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.xl,
        alignItems: 'center',
    },
    emptyTitle: {
        marginTop: spacing.md,
        color: colors.textPrimary,
        fontSize: fonts.sizes.md,
        fontWeight: '600',
    },
    emptySub: {
        marginTop: spacing.xs,
        color: colors.textMuted,
        fontSize: fonts.sizes.sm,
        textAlign: 'center',
        lineHeight: 20,
    },
    emptyAction: {
        marginTop: spacing.lg,
        backgroundColor: colors.white,
        borderRadius: radius.full,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    emptyActionText: {
        color: colors.bg,
        fontSize: fonts.sizes.sm,
        fontWeight: '600',
    },
    listWrap: {
        gap: spacing.sm,
    },
    entryCard: {
        backgroundColor: colors.bgSecondary,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
    },
    entryTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    entryTimeWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    entryTime: {
        color: colors.textSecondary,
        fontSize: fonts.sizes.xs,
        fontWeight: '600',
    },
    entrySourcePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: radius.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    entrySourceText: {
        fontSize: 10,
        fontWeight: '600',
    },
    entryText: {
        marginTop: spacing.sm,
        color: colors.textPrimary,
        fontSize: fonts.sizes.sm,
        lineHeight: 21,
    },
    entryFooter: {
        marginTop: spacing.md,
        flexDirection: 'row',
        justifyContent: 'flex-start',
    },
    entryMetaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: radius.full,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    entryMetaText: {
        color: colors.textMuted,
        fontSize: fonts.sizes.xs,
    },
});

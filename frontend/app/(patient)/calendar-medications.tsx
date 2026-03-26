import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Header from '../../src/components/Header';
import Screen from '../../src/components/Screen';
import api from '../../src/services/api';
import { colors, fonts, spacing, radius } from '../../src/theme';
import { Ionicons } from '@expo/vector-icons';

interface Med {
    id: string;
    name: string;
    dosage: string;
    frequency: string;
    schedule_times: string[];
    is_active: boolean;
    last_taken: string | null;
}

type MedFilter = 'all' | 'pending' | 'taken' | 'overdue';
type MedStatus = Exclude<MedFilter, 'all'>;

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

//------This Function handles the Format Schedule---------
function formatSchedule(times: string[]) {
    if (!times || times.length === 0) {
        return 'All day';
    }
    if (times.length <= 2) {
        return times.join(' • ');
    }
    return `${times.slice(0, 2).join(' • ')} +${times.length - 2}`;
}

//------This Function handles the Get Status Meta---------
function getStatusMeta(status: MedStatus) {
    if (status === 'taken') {
        return {
            label: 'Taken',
            icon: 'checkmark-done-outline',
            textColor: colors.bg,
            bgColor: colors.primary,
        };
    }

    if (status === 'overdue') {
        return {
            label: 'Overdue',
            icon: 'alert-circle-outline',
            textColor: colors.red,
            bgColor: 'rgba(255,59,48,0.12)',
        };
    }

    return {
        label: 'Pending',
        icon: 'time-outline',
        textColor: colors.textSecondary,
        bgColor: colors.surface,
    };
}

//------This Function handles the Calendar Medications Screen---------
export default function CalendarMedicationsScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ date?: string | string[] }>();
    //------This Function handles the Selected Date---------
    const selectedDate = useMemo(() => parseDateParam(params.date), [params.date]);
    //------This Function handles the Today---------
    const today = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    const [meds, setMeds] = useState<Med[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<MedFilter>('all');

    //------This Function handles the Load---------
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/medications/', { params: { _t: Date.now() } });
            setMeds(res.data || []);
        } catch (error) {
            console.error('[CalendarMedications] load failed', error);
            Alert.alert('Error', 'Could not load medications');
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    //------This Function handles the Active Meds---------
    const activeMeds = useMemo(() => meds.filter((m) => m.is_active), [meds]);

    //------This Function handles the Is Med Taken---------
    function isMedTaken(med: Med): boolean {
        if (!med.last_taken) {
            return false;
        }
        return isSameDay(new Date(med.last_taken), selectedDate);
    }

    //------This Function handles the Is Med Overdue---------
    function isMedOverdue(med: Med): boolean {
        if (!isSameDay(selectedDate, today)) {
            return false;
        }
        if (isMedTaken(med)) {
            return false;
        }
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        return (med.schedule_times || []).some((time) => {
            const [h, m] = time.split(':').map(Number);
            return h * 60 + (m || 0) < currentMinutes;
        });
    }

    //------This Function handles the Get Med Status---------
    function getMedStatus(med: Med): MedStatus {
        if (isMedTaken(med)) {
            return 'taken';
        }
        if (isMedOverdue(med)) {
            return 'overdue';
        }
        return 'pending';
    }

    //------This Function handles the Counts---------
    const counts = useMemo(() => {
        let taken = 0;
        let pending = 0;
        let overdue = 0;

        for (const med of activeMeds) {
            const status = getMedStatus(med);
            if (status === 'taken') taken += 1;
            if (status === 'pending') pending += 1;
            if (status === 'overdue') overdue += 1;
        }

        return { taken, pending, overdue };
    }, [activeMeds, selectedDate, today]);

    const completionPct = activeMeds.length > 0
        ? Math.round((counts.taken / activeMeds.length) * 100)
        : 0;

    //------This Function handles the Visible Meds---------
    const visibleMeds = useMemo(() => {
        if (filter === 'all') {
            return activeMeds;
        }
        return activeMeds.filter((med) => getMedStatus(med) === filter);
    }, [activeMeds, filter, selectedDate, today]);

    //------This Function handles the Mark Taken---------
    async function markTaken(id: string) {
        console.log(`[CalendarMedications] markTaken triggered for id: ${id}`);
        try {
            const endpoint = `/medications/${id}/take`;
            console.log(`[CalendarMedications] Sending POST to ${endpoint}`);
            const response = await api.post(endpoint, {});
            console.log(`[CalendarMedications] Backend Response:`, response.status);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            load();
        } catch (error) {
            console.error('[CalendarMedications] mark taken failed', error);
            Alert.alert('Error', 'Could not mark medication as taken. Is the backend reachable?');
        }
    }

    return (
        <Screen safeArea={false}>
            <Header
                title="Medications"
                subtitle={selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                showBack
                centered
                onBackPress={() => router.back()}
                rightElement={
                    <TouchableOpacity style={s.headerAction} onPress={() => router.push('/(patient)/edit-medications')}>
                        <Ionicons name="create-outline" size={18} color={colors.textPrimary} />
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
                                <Text style={s.heroLabel}>Daily Progress</Text>
                                <Text style={s.heroValue}>{activeMeds.length > 0 ? `${counts.taken}/${activeMeds.length}` : '0'}</Text>
                                <Text style={s.heroSub}>medications taken</Text>
                            </View>
                            <View style={s.heroBadge}>
                                <Text style={s.heroBadgeText}>{completionPct}%</Text>
                            </View>
                        </View>
                        <View style={s.progressTrack}>
                            <View style={[s.progressFill, { width: `${completionPct}%` }]} />
                        </View>
                        <View style={s.statsRow}>
                            <View style={s.statItem}>
                                <Text style={s.statValue}>{counts.pending}</Text>
                                <Text style={s.statLabel}>Pending</Text>
                            </View>
                            <View style={s.statDivider} />
                            <View style={s.statItem}>
                                <Text style={[s.statValue, counts.overdue > 0 && s.statValueDanger]}>{counts.overdue}</Text>
                                <Text style={s.statLabel}>Overdue</Text>
                            </View>
                            <View style={s.statDivider} />
                            <View style={s.statItem}>
                                <Text style={s.statValue}>{activeMeds.length}</Text>
                                <Text style={s.statLabel}>Total</Text>
                            </View>
                        </View>
                    </View>

                    {activeMeds.length > 0 && (
                        <View style={s.filtersRow}>
                            {([
                                { key: 'all', label: 'All', count: activeMeds.length },
                                { key: 'pending', label: 'Pending', count: counts.pending },
                                { key: 'taken', label: 'Taken', count: counts.taken },
                                { key: 'overdue', label: 'Overdue', count: counts.overdue },
                            ] as Array<{ key: MedFilter; label: string; count: number }>).map((item) => (
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

                    {activeMeds.length === 0 ? (
                        <View style={s.emptyCard}>
                            <Ionicons name="medkit-outline" size={30} color={colors.textMuted} />
                            <Text style={s.emptyTitle}>No Active Medications</Text>
                            <Text style={s.emptySub}>Add medications to start tracking your day.</Text>
                            <TouchableOpacity style={s.emptyAction} onPress={() => router.push('/(patient)/edit-medications')}>
                                <Ionicons name="add-circle-outline" size={16} color={colors.bg} />
                                <Text style={s.emptyActionText}>Add Medication</Text>
                            </TouchableOpacity>
                        </View>
                    ) : visibleMeds.length === 0 ? (
                        <View style={s.emptyCard}>
                            <Ionicons name="filter-outline" size={26} color={colors.textMuted} />
                            <Text style={s.emptyTitle}>Nothing Here</Text>
                            <Text style={s.emptySub}>No medications match this filter.</Text>
                        </View>
                    ) : (
                        <View style={s.listWrap}>
                            {visibleMeds.map((med) => {
                                const status = getMedStatus(med);
                                const meta = getStatusMeta(status);
                                const canMarkTaken = status !== 'taken';

                                return (
                                    <View key={med.id} style={s.medCard}>
                                        <View style={s.medTopRow}>
                                            <View style={s.medTitleWrap}>
                                                <View style={[s.medIconWrap, status === 'overdue' && s.medIconWrapOverdue]}>
                                                    <Ionicons name="medical" size={16} color={status === 'overdue' ? colors.red : colors.textSecondary} />
                                                </View>
                                                <View>
                                                    <Text style={s.medName}>{med.name}</Text>
                                                    <Text style={s.medDose}>{med.dosage || 'No dosage provided'}</Text>
                                                </View>
                                            </View>

                                            <View style={[s.statusPill, { backgroundColor: meta.bgColor }]}>
                                                <Ionicons name={meta.icon as any} size={12} color={meta.textColor} />
                                                <Text style={[s.statusText, { color: meta.textColor }]}>{meta.label}</Text>
                                            </View>
                                        </View>

                                        <View style={s.metaRow}>
                                            <View style={s.metaChip}>
                                                <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                                                <Text style={s.metaText}>{formatSchedule(med.schedule_times || [])}</Text>
                                            </View>
                                            <View style={s.metaChip}>
                                                <Ionicons name="repeat-outline" size={13} color={colors.textMuted} />
                                                <Text style={s.metaText}>{med.frequency || 'Daily'}</Text>
                                            </View>
                                        </View>

                                        <TouchableOpacity
                                            style={[s.takeBtn, !canMarkTaken && s.takeBtnDone]}
                                            onPress={() => canMarkTaken && markTaken(med.id)}
                                            activeOpacity={0.9}
                                            disabled={!canMarkTaken}
                                        >
                                            <Ionicons name={canMarkTaken ? 'checkmark-outline' : 'checkmark-done-outline'} size={16} color={canMarkTaken ? colors.bg : colors.white} />
                                            <Text style={[s.takeBtnText, !canMarkTaken && s.takeBtnTextDone]}>
                                                {canMarkTaken ? 'Mark as Taken' : 'Taken'}
                                            </Text>
                                        </TouchableOpacity>
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
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.full,
    },
    heroBadgeText: {
        color: colors.primary,
        fontSize: fonts.sizes.sm,
        fontWeight: '600',
    },
    progressTrack: {
        marginTop: spacing.md,
        height: 6,
        borderRadius: radius.full,
        backgroundColor: colors.surface,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: colors.primary,
        borderRadius: radius.full,
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
    statValueDanger: {
        color: colors.red,
    },
    statLabel: {
        color: colors.textMuted,
        fontSize: fonts.sizes.xs,
        marginTop: 2,
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
    medCard: {
        backgroundColor: colors.bgSecondary,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
    },
    medTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: spacing.sm,
    },
    medTitleWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        flex: 1,
    },
    medIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
    },
    medIconWrapOverdue: {
        backgroundColor: 'rgba(255,59,48,0.12)',
        borderColor: 'rgba(255,59,48,0.25)',
    },
    medName: {
        color: colors.textPrimary,
        fontSize: fonts.sizes.md,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    medDose: {
        color: colors.textMuted,
        fontSize: fonts.sizes.xs,
        marginTop: 2,
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: radius.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 5,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    metaRow: {
        marginTop: spacing.sm,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
    },
    metaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    metaText: {
        color: colors.textSecondary,
        fontSize: 11,
        fontWeight: '500',
    },
    takeBtn: {
        marginTop: spacing.md,
        backgroundColor: colors.white,
        borderRadius: radius.full,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: spacing.xs,
    },
    takeBtnDone: {
        backgroundColor: colors.surfaceLight,
    },
    takeBtnText: {
        color: colors.bg,
        fontSize: fonts.sizes.sm,
        fontWeight: '600',
    },
    takeBtnTextDone: {
        color: colors.white,
    },
});

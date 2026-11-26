/**
 * Browser half of the collaboration-session plugin.
 *
 * The left sidebar's `sidebar.session.action` layer wraps the New-session row.
 * We keep the owner's New Session control and add one sibling entry that asks
 * the Workspace navigation service for a New Session under the `collab` Agent
 * preset in the currently selected Workspace. The Host half prepares the
 * per-session comm/private layout inside that Workspace.
 *
 * A small watcher activates a collab Session when its Agent starts running
 * because a peer message woke it, so the user sees the incoming request and
 * the result instead of having to find the session manually.
 */
window.__ModuleLoader__.load({
  id: '@xmodelin/dsh-collab-sessions',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-collab-sessions'
    /** Compatibility copy and selectors tied to DSH preset chrome. */
    const COMPAT = Object.freeze({
      presetText: /(协同会话|超级会话|Collab session|Supervisor session)/u,
      modeChip:
        'button[aria-haspopup="menu"][title*="Agent 预设"],'
        + 'button[aria-haspopup="menu"][title*="Agent preset"]',
      labels: Object.freeze({
        collab: '协同会话',
        supervisor: '超级会话',
        collabEn: 'Collab session',
        supervisorEn: 'Supervisor session',
      }),
    })

    const BOARD_TAB_ID = '@xmodelin/dsh-collab-sessions/supervisor-tasks'
    const BOARD_TAB_KIND = 'collabSupervisorTasks'
    const WORKERS_TAB_ID = '@xmodelin/dsh-collab-sessions/supervisor-workers'
    const WORKERS_TAB_KIND = 'collabSupervisorWorkers'
    let MenuItemButton
    let Button
    let IconCopyOutlineRegular
    let IconChecklistOutlineRegular
    let IconUserOutlineRegular
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      MenuItemButton = primitives.MenuItemButton
      Button = primitives.Button
      IconCopyOutlineRegular = primitives.IconCopyOutlineRegular
      IconChecklistOutlineRegular = primitives.IconChecklistOutlineRegular
      IconUserOutlineRegular = primitives.IconUserOutlineRegular
    } catch {
      MenuItemButton = undefined
      Button = undefined
      IconCopyOutlineRegular = undefined
      IconChecklistOutlineRegular = undefined
      IconUserOutlineRegular = undefined
    }

    const ZH = {
      'entry.short': '协同',
      'entry.label': '新建协同会话',
      'entry.hint': '新建协同会话或超级会话；超级会话只做协调调度',
      'entry.noWorkspace': '请先打开一个工作区。',
      'entry.notReady': '工作区仍在加载，请稍后重试。',
      'entry.createFailed': '无法新建协同会话，请稍后重试。',
      'entry.menuCollab': '协同会话',
      'entry.menuSupervisor': '超级会话',
      'panel.label': '协同授权',
      'panel.title': '协同授权',
      'panel.description': '只有协同会话支持相互通信；授权是双向的，必须双方都授权后才能通信。在“已授权会话对”查看现有关系，在“协同会话”勾选两个会话完成授权。',
      'panel.pairs': '已授权的会话对（双方）',
      'panel.pairsTab': '已授权会话对',
      'panel.sessionsTab': '协同会话',
      'panel.sessions': '协同会话',
      'panel.emptyPairs': '还没有双方都授权的会话对。',
      'panel.emptySessions': '还没有协同会话。先点“协同”创建一个。',
      'panel.pending': '单方已授权（通信仍被拒绝）',
      'panel.oneSided': '单方已授权',
      'panel.complete': '补齐双方',
      'panel.authorize': '为双方授权',
      'panel.revoke': '撤销',
      'panel.confirmRevoke': '确认撤销',
      'panel.refresh': '刷新',
      'panel.loading': '加载中…',
      'panel.selectTwo': '请选择两个协同会话。',
      'panel.authorizedNotice': '双方已授权。',
      'panel.revokedNotice': '已撤销双方授权。',
      'panel.error': '操作失败',
      'panel.running': '运行中',
      'auth.open': '打开协同授权',
      'base.menu': '设置会话提示词',
      'copy.title': '复制会话名',
      'copy.done': '会话名已复制',
      'copy.failed': '复制失败，请重试',
      'base.title': '会话提示词',
      'base.session': '会话',
      'base.description': '这条会话提示词会注入当前协同会话后续的每一轮，可用于设定角色和约束。',
      'base.placeholder': '例如：你是代码审查员；只审查，不修改文件；回答使用中文。',
      'base.save': '保存',
      'base.cancel': '取消',
      'base.saving': '保存中…',
      'base.loading': '加载中…',
      'base.error': '操作失败',
      'base.heroButton': '设置提示词',
      'board.title': '任务看板',
      'board.tasksTitle': '任务列表',
      'board.tasksGuide': '查看 supervisor 的任务与子任务',
      'board.tasksGuideCount': '{active} 个进行中 · {total} 个任务',
      'board.workersTitle': '注册中心',
      'board.workersGuide': '查看已登记的协同会话与能力',
      'board.workersGuideCount': '{total} 个已登记会话',
      'board.allProjects': '全部任务',
      'board.capabilityBoard': '能力登记',
      'board.open': '任务',
      'board.workers': '已 offer 的协同会话',
      'board.available': '未 offer 的协同会话',
      'board.offer': 'Offer',
      'board.emptyAvailable': '没有可 offer 的协同会话。',
      'board.tasks': '子任务',
      'board.projects': '任务',
      'board.parentTask': '任务',
      'board.subtask': '子任务',
      'board.add': '登记功能会话',
      'board.capability': '能力名称',
      'board.description': '能力描述',
      'board.selectWorker': '选择功能会话',
      'board.register': '登记',
      'board.unlink': '注销',
      'board.refresh': '刷新',
      'board.locate': '定位到对话',
      'board.sourceLive': '实时能力',
      'board.sourceOverride': '固定能力',
      'board.changed': '能力已更新',
      'board.pin': '固定当前',
      'board.viewDetails': '查看会话详情',
      'board.detailsTitle': '会话能力详情',
      'board.description': '能力描述',
      'board.workerId': '会话 ID',
      'board.source': '能力来源',
      'board.version': '能力版本',
      'board.noDescription': '未填写能力描述。',
      'board.close': '关闭',
      'board.pinnedNotice': '已固定当前能力。',
      'board.liveNotice': '已切换为实时能力。',
      'board.requests': '已接收请求',
      'board.emptyRequests': '还没有已接收请求。',
      'board.requester': '请求方',
      'board.worker': '处理方',
      'board.noLinkedTask': '该请求尚未创建任务。',
      'board.prevPage': '上一页',
      'board.nextPage': '下一页',
      'preset.collabName': '协同会话',
      'preset.collabDescription': '拥有独立的 .dsh-collab 工作目录、共享的 comm/ 目录和仅本会话可访问的 private/ 目录，并提供经过身份验证的会话间通信工具。',
      'preset.supervisorName': '超级会话',
      'preset.supervisorDescription': '负责拆解需求、把子任务分派给已登记的功能会话、核验结果并完成交付；不提供任何实现类工具。',
      'board.taskDetail': '子任务详情',
      'board.close': '关闭',
      'board.noResult': '暂无结果。',
      'status.pending': '待处理',
      'status.accepted': '已受理',
      'status.rejected': '已拒绝',
      'status.expired': '已过期',
      'status.cancelled': '已取消',
      'status.delivered': '已交付',
      'status.created': '待分配',
      'status.assigned': '已分配',
      'status.running': '执行中',
      'status.done': '已完成',
      'status.failed': '失败',
      'status.open': '进行中',
      'status.closed': '已关闭',
      'board.search': '搜索能力描述',
      'board.searchEmpty': '无匹配内容。',
      'board.expand': '展开',
      'board.collapse': '收起',
      'board.useLive': '使用实时',
      'board.noLocation': '该任务没有可定位的对话记录。',
      'board.notFound': '未找到对应的对话位置，可能尚未加载。',
      'board.emptyWorkers': '还没有登记功能会话。',
      'board.emptyTasks': '还没有子任务。',
      'board.loading': '加载中…',
      'board.open': '任务',
      'board.openTitle': '打开 supervisor 任务面板',
      'board.overdue': '已超期',
      'board.error': '操作失败',
      'board.registerHint': '登记会同时完成双向通信授权；Phase 1 只开放被指派（offer）。',
      'board.confirmUnlink': '注销该功能会话并撤销通信授权？',
    }
    const EN = {
      'entry.short': 'Collab',
      'entry.label': 'New collab session',
      'entry.hint': 'Start a collab or supervisor session in the current Workspace',
      'entry.noWorkspace': 'Open a workspace first.',
      'entry.notReady': 'Workspaces are still loading; try again in a moment.',
      'entry.createFailed': 'Could not start the collab session; try again.',
      'entry.menuCollab': 'Collab session',
      'entry.menuSupervisor': 'Supervisor session',
      'panel.label': 'Collab access',
      'panel.title': 'Collab access',
      'panel.description': 'Only collab sessions can message each other, and authorization is bilateral: both sides must authorize before communication works. The upper section lists fully authorized pairs (and one-sided grants still waiting for the other side); the lower section lists collab sessions. Select two collab sessions to authorize both sides.',
      'panel.pairs': 'Authorized pairs (both sides)',
      'panel.pairsTab': 'Authorized pairs',
      'panel.sessionsTab': 'Collab sessions',
      'panel.sessions': 'Collab sessions',
      'panel.emptyPairs': 'No pair has both sides authorized yet.',
      'panel.emptySessions': 'No collab sessions yet. Create one with Collab.',
      'panel.pending': 'One-sided grants (communication still refused)',
      'panel.oneSided': 'One-sided',
      'panel.complete': 'Authorize both',
      'panel.authorize': 'Authorize both sides',
      'panel.revoke': 'Revoke',
      'panel.confirmRevoke': 'Confirm revoke',
      'panel.refresh': 'Refresh',
      'panel.loading': 'Loading…',
      'panel.selectTwo': 'Select exactly two collab sessions.',
      'panel.noControl': 'Open a collab session first.',
      'panel.authorizedNotice': 'Both sides authorized.',
      'panel.revokedNotice': 'Both sides revoked.',
      'panel.error': 'Operation failed',
      'panel.running': 'Running',
      'auth.open': 'Open Collab access',
      'base.menu': 'Set session prompt',
      'copy.title': 'Copy session name',
      'copy.done': 'Session name copied',
      'copy.failed': 'Copy failed; try again',
      'base.title': 'Session prompt',
      'base.session': 'Session',
      'base.description': 'This session prompt is injected into every subsequent turn of the current collaboration session; use it for a role and constraints.',
      'base.placeholder': 'For example: You are a code reviewer. Only review; never edit files. Answer in Chinese.',
      'base.save': 'Save',
      'base.cancel': 'Cancel',
      'base.saving': 'Saving…',
      'base.loading': 'Loading…',
      'base.error': 'Operation failed',
      'base.heroButton': 'Set prompt',
      'board.title': 'Task board',
      'board.tasksTitle': 'Task list',
      'board.workersTitle': 'Registration center',
      'board.allProjects': 'All tasks',
      'board.capabilityBoard': 'Capabilities',
      'board.open': 'Tasks',
      'board.workers': 'Offered collaboration sessions',
      'board.available': 'Collaboration sessions not offered',
      'board.offer': 'Offer',
      'board.emptyAvailable': 'No collaboration sessions available to offer.',
      'board.tasks': 'Subtasks',
      'board.projects': 'Tasks',
      'board.parentTask': 'Task',
      'board.subtask': 'Subtask',
      'board.add': 'Register worker',
      'board.capability': 'Capability name',
      'board.description': 'Capability description',
      'board.selectWorker': 'Select a functional session',
      'board.register': 'Register',
      'board.unlink': 'Unregister',
      'board.refresh': 'Refresh',
      'board.locate': 'Locate in conversation',
      'board.sourceLive': 'Live capability',
      'board.sourceOverride': 'Pinned capability',
      'board.changed': 'Capability updated',
      'board.pin': 'Pin current',
      'board.viewDetails': 'View session details',
      'board.detailsTitle': 'Session capability details',
      'board.description': 'Capability description',
      'board.workerId': 'Session ID',
      'board.source': 'Capability source',
      'board.version': 'Capability version',
      'board.noDescription': 'No capability description provided.',
      'board.close': 'Close',
      'board.pinnedNotice': 'Capability pinned.',
      'board.liveNotice': 'Switched to live capability.',
      'board.requests': 'Received requests',
      'board.emptyRequests': 'No received requests yet.',
      'board.requester': 'Requester',
      'board.worker': 'Worker',
      'board.noLinkedTask': 'No task has been created for this request yet.',
      'board.prevPage': 'Previous',
      'board.nextPage': 'Next',
      'preset.collabName': 'Collab session',
      'preset.collabDescription': 'A session with its own .dsh-collab working directory, a shared comm/ directory, a session-only private/ directory, and authenticated session-to-session messaging.',
      'preset.supervisorName': 'Supervisor session',
      'preset.supervisorDescription': 'Coordinates requirements, assigns subtasks to registered functional sessions, verifies results, and delivers. It has no implementation tools.',
      'board.taskDetail': 'Subtask details',
      'board.close': 'Close',
      'board.noResult': 'No result yet.',
      'status.pending': 'Pending',
      'status.accepted': 'Accepted',
      'status.rejected': 'Rejected',
      'status.expired': 'Expired',
      'status.cancelled': 'Cancelled',
      'status.delivered': 'Delivered',
      'status.created': 'Unassigned',
      'status.assigned': 'Assigned',
      'status.running': 'Running',
      'status.done': 'Done',
      'status.failed': 'Failed',
      'status.open': 'Open',
      'status.closed': 'Closed',
      'board.search': 'Search capability description',
      'board.searchEmpty': 'No matching content.',
      'board.expand': 'Expand',
      'board.collapse': 'Collapse',
      'board.useLive': 'Use live',
      'board.noLocation': 'This task has no recorded conversation position.',
      'board.notFound': 'The conversation position is not loaded yet.',
      'board.emptyWorkers': 'No functional sessions registered yet.',
      'board.emptyTasks': 'No subtasks yet.',
      'board.loading': 'Loading…',
      'board.open': 'Tasks',
      'board.openTitle': 'Open the supervisor task panel',
      'board.overdue': 'overdue',
      'board.error': 'Operation failed',
      'board.registerHint': 'Registration also authorizes the communication pair; Phase 1 exposes offer only.',
      'board.confirmUnlink': 'Unregister this worker and revoke its communication authorization?',
    }

    const FALLBACK = EN
    function fallbackT(key) {
      return FALLBACK[key] ?? key
    }
    const selectSnapshot = snapshot => snapshot

    function isCollabSummary(summary, state) {
      if (summary === undefined) return false
      const values = summary.projectionValues ?? state?.projectionsBySession?.[summary.id]?.values
      const preset = values?.agentPreset
      return preset === 'collab' || preset === 'supervisor'
    }

    const CSS = [
      '.dsh-collab-new-stack{display:flex;flex-direction:column;align-items:stretch;gap:6px;width:100%;min-width:0}',
      '.dsh-collab-new-stack[data-wide="false"]{width:36px;align-items:flex-start;gap:4px}',
      '.dsh-collab-new-owner{display:flex;align-items:center;width:100%;min-width:0}',
      '.dsh-collab-new-owner>*{flex:1 1 auto;min-width:0}',
      '.dsh-collab-new-cell{position:relative;flex:0 0 auto;display:flex;flex-direction:column;gap:4px;min-width:0;width:100%}',
      '.dsh-collab-new-button{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:38px;padding:8px 12px;margin:0;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;overflow:hidden}',
      '.dsh-collab-new-button[data-wide="false"]{width:36px;height:36px;padding:0;gap:0;border-color:transparent;background:transparent}',
      'html[data-platform="darwin"] .dsh-collab-new-button[data-wide="true"]{background:var(--dsw-specific-sidebar-glass-fill,var(--dsw-alias-button-elevated-fill))}',
      '.dsh-collab-new-button[data-error="true"]{border-color:var(--dsw-alias-state-error-primary)}',
      '.dsh-collab-new-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-collab-new-alert{max-width:180px;font-size:11px;line-height:15px;color:var(--dsw-alias-state-error-primary)}',
      '.dsh-collab-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '@media (hover:hover){.dsh-collab-new-button:hover{background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-bg-layer-2))}}',
      '@media (hover:hover){.dsh-collab-new-button[data-wide="false"]:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}}',
      '@media (hover:hover){html[data-platform="darwin"] .dsh-collab-new-button[data-wide="true"]:hover{background:var(--dsw-specific-sidebar-glass-hover,var(--dsw-alias-button-floating-hover))}}',
      '.dsh-collab-new-menu-backdrop{position:fixed;inset:0;z-index:1000;background:transparent}',
      '.dsh-collab-new-menu{position:fixed;z-index:1001;min-width:180px;padding:4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgba(0,0,0,.18)}',
      '.dsh-collab-new-menu-item{display:flex;align-items:center;justify-content:center;width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;font-weight:600;text-align:center;cursor:pointer}',
      '.dsh-collab-new-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-collab-new-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}',
    ].join('')

    /** Two linked speech bubbles; inherits the button's text color. */
    function CollabIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 36 36',
        width: size,
        height: size,
        'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', {
        d: 'M5.5 10.2A3.2 3.2 0 0 1 8.7 7h8.6a3.2 3.2 0 0 1 3.2 3.2v5.6a3.2 3.2 0 0 1-3.2 3.2h-4.9l-4 3.1a1 1 0 0 1-1.6-.8v-2.4a3.2 3.2 0 0 1-1.9-2.9z',
        fill: 'currentColor',
      }),
      h('path', {
        d: 'M14.5 21.6a3.2 3.2 0 0 1 3.2-3.2h7.6a3.2 3.2 0 0 1 3.2 3.2v4.6a3.2 3.2 0 0 1-3.2 3.2h-1v2.6a1 1 0 0 1-1.6.8l-3.3-3.4h-1.7a3.2 3.2 0 0 1-3.2-3.2z',
        fill: 'currentColor',
        opacity: 0.55,
      }))
    }

    function CollabNewSessionControls(props) {
      const wide = props.wide === true
      const t = typeof props.t === 'function'
        ? props.t
        : (typeof props.translate === 'function' ? props.translate : fallbackT)
      const workspace = props.useWorkspaces(selectSnapshot)
      const sessions = props.useSessions(selectSnapshot)
      const workspaceCount = workspace?.items?.length ?? 0
      const workspaceReady = workspace?.phase === 'ready'
      const sessionsReady = sessions?.phase === 'ready'
      const [error, setError] = React.useState(null)
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [menuPos, setMenuPos] = React.useState(null)
      const buttonRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const menuId = React.useId()
      const alertId = React.useId()
      const label = t('entry.label')
      const hint = t('entry.hint')

      React.useEffect(() => {
        if (workspaceReady && sessionsReady && workspaceCount > 0) setError(null)
      }, [workspaceReady, sessionsReady, workspaceCount])

      React.useEffect(() => {
        if (!menuOpen) return undefined
        const first = menuRef.current?.querySelector('[role="menuitem"]')
        if (first !== undefined) first.focus()
        const close = () => { setMenuOpen(false); buttonRef.current?.focus() }
        window.addEventListener('resize', close)
        return () => window.removeEventListener('resize', close)
      }, [menuOpen])

      const moveMenuFocus = (event) => {
        const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])]
        if (items.length === 0) return
        const index = items.indexOf(document.activeElement)
        let next = index
        if (event.key === 'ArrowDown') next = (index + 1) % items.length
        else if (event.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else return
        event.preventDefault()
        items[next].focus()
      }

      const openMenu = () => {
        if (!workspaceReady || !sessionsReady) {
          setError({ key: 'notReady' })
          return
        }
        if (workspaceCount < 1) {
          setError({ key: 'noWorkspace' })
          return
        }
        setError(null)
        const rect = buttonRef.current?.getBoundingClientRect()
        const width = Math.max(rect?.width ?? 180, 180)
        const maxLeft = typeof window === 'undefined' ? 0 : Math.max(8, window.innerWidth - width - 8)
        const left = Math.min(rect?.left ?? 8, maxLeft)
        setMenuPos({ left, top: (rect?.bottom ?? 0) + 4, width })
        setMenuOpen(true)
      }

      const launch = (preset) => {
        setMenuOpen(false)
        try {
          props.start(preset)
        } catch (failure) {
          console.error('[collab-sessions] could not start a session:', failure)
          const detail = failure instanceof Error ? failure.message : String(failure)
          setError({
            key: 'createFailed',
            detail: detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
          })
        }
      }

      const errorText = error === null
        ? undefined
        : t(`entry.${error.key}`) + (error.detail === undefined ? '' : ` (${error.detail})`)
      const button = h('button', {
        ref: buttonRef,
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': menuOpen ? 'true' : 'false',
        'aria-controls': menuOpen ? menuId : undefined,
        title: errorText ?? hint,
        'aria-label': label,
        'aria-invalid': error === null ? undefined : 'true',
        'aria-describedby': error === null ? undefined : alertId,
        'data-wide': wide ? 'true' : 'false',
        'data-error': error === null ? 'false' : 'true',
        'data-collab-entry': 'true',
        className: 'dsh-collab-new-button',
        onClick: openMenu,
        onKeyDown: (event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          if (menuOpen) menuRef.current?.querySelector('[role="menuitem"]')?.focus()
          else openMenu()
        },
      },
      h(CollabIcon, { size: wide ? 16 : 18 }),
      wide ? h('span', { className: 'dsh-collab-new-label' }, t('entry.label')) : null)

      const alert = errorText === undefined
        ? null
        : h('span', {
            id: alertId,
            role: 'alert',
            className: wide ? 'dsh-collab-new-alert' : 'dsh-collab-sr',
          }, errorText)

      const menu = menuOpen && menuPos !== null
        ? h(React.Fragment, null,
            h('div', { className: 'dsh-collab-new-menu-backdrop', onClick: () => setMenuOpen(false) }),
            h('div', {
              ref: menuRef,
              id: menuId,
              className: 'dsh-collab-new-menu',
              role: 'menu',
              style: { left: menuPos.left, top: menuPos.top, width: menuPos.width },
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMenuOpen(false)
                  buttonRef.current?.focus()
                  return
                }
                moveMenuFocus(event)
              },
            },
            h('button', {
              type: 'button',
              role: 'menuitem',
              tabIndex: -1,
              className: 'dsh-collab-new-menu-item',
              onClick: () => launch('collab'),
            }, t('entry.menuCollab')),
            h('button', {
              type: 'button',
              role: 'menuitem',
              tabIndex: -1,
              className: 'dsh-collab-new-menu-item',
              onClick: () => launch('supervisor'),
            }, t('entry.menuSupervisor'))))
        : null
      return h(React.Fragment, null,
        h('style', null, CSS),
        h('div', {
          className: 'dsh-collab-new-stack',
          'data-wide': wide ? 'true' : 'false',
        },
        h('div', { className: 'dsh-collab-new-owner' }, props.children),
        h('div', { className: 'dsh-collab-new-cell' }, button, alert)),
        menu)
    }

    const AUTH_CSS = [
      '.dsh-collab-auth{display:flex;flex-direction:column;gap:16px;padding:22px 24px;max-width:860px;margin:0 auto;box-sizing:border-box;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dsh-collab-auth-head{flex:none;display:flex;flex-direction:column;gap:4px}',
      '.dsh-collab-auth-title{margin:0;font-size:18px;line-height:24px;font-weight:600}',
      '.dsh-collab-auth-desc{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dsh-collab-auth-card{border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px;display:flex;flex-direction:column;gap:8px;min-height:0;flex:none}',
      '.dsh-collab-auth-card[data-grow="true"]{flex:1 1 auto;min-height:0}',
      '.dsh-collab-auth-tabs-row{flex:none;display:flex;align-items:center;gap:4px;border-bottom:0.5px solid var(--dsw-alias-border-l1);padding-bottom:8px}',
      '.dsh-collab-auth-tabs{display:flex;align-items:center;gap:4px;min-width:0}',
      '.dsh-collab-auth-tabs-actions{margin-left:auto;display:flex;align-items:center;gap:6px}',
      '.dsh-collab-auth-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}',
      '.dsh-collab-auth-tab{height:30px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-collab-auth-tab:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-collab-auth-tab[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dsh-collab-auth-content{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.dsh-collab-auth-content>.dsh-collab-auth-card{flex:1 1 auto;min-height:0;max-height:none}',
      '.dsh-collab-auth-list{display:flex;flex-direction:column;gap:2px;min-height:0;flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}',
      '.dsh-collab-auth-footer{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding-top:8px;margin-top:2px;border-top:0.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-collab-auth-hint{flex:1 1 180px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dsh-collab-auth-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}',
      '.dsh-collab-auth-row{display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;min-width:0}',
      '.dsh-collab-auth-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-collab-auth-row input{flex:none;margin:0;accent-color:var(--dsw-alias-brand-primary)}',
      '.dsh-collab-auth-title-cell{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-collab-auth-id{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--dsh-font-mono,monospace);font-size:11px}',
      '.dsh-collab-auth-badge{flex:none;padding:1px 7px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
      '.dsh-collab-auth-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}',
      '.dsh-collab-auth-pair{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-collab-auth-button{flex:none;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-collab-auth-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '.dsh-collab-auth-button:disabled{opacity:.45;cursor:default}',
      '.dsh-collab-auth-button[data-danger="true"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-collab-auth-button[data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.dsh-collab-auth-button[data-primary="true"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));color:var(--dsw-alias-bg-base)}',
      '.dsh-collab-auth-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
      '.dsh-collab-auth-notice{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}',
      '.dsh-collab-auth-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    ].join('')

    function shortId(id) {
      return typeof id === 'string' && id.length > 20 ? `${id.slice(0, 12)}…${id.slice(-4)}` : String(id)
    }

    /** Shield with two linked nodes: authorization management. */
    function CollabAuthIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 36 36', width: size, height: size, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      h('path', {
        d: 'M18 5.5 7.5 9.6v7.2c0 5.9 4.3 11.2 10.5 13.7 6.2-2.5 10.5-7.8 10.5-13.7V9.6z',
        fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round',
      }),
      h('circle', { cx: 14, cy: 18, r: 2.2, fill: 'currentColor' }),
      h('circle', { cx: 22, cy: 18, r: 2.2, fill: 'currentColor' }),
      h('path', { d: 'M16.2 18h3.6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }))
    }

    function CollabAuthPanel(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const sessions = props.useSessions(selectSnapshot)
      const roots = (sessions?.ids ?? [])
        .map(id => sessions.byId[id])
        .filter(summary => summary !== undefined && summary.origin !== 'subagent' && isCollabSummary(summary, sessions))
      const sorted = [...roots].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      const [pairs, setPairs] = React.useState([])
      const [pendingGrants, setPendingGrants] = React.useState([])
      const [activeTab, setActiveTab] = React.useState('pairs')
      const [selected, setSelected] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [confirmRevoke, setConfirmRevoke] = React.useState(null)

      const titleOf = id => sessions?.byId?.[id]?.displayTitle ?? shortId(id)
      const presetOf = id => (sessions?.byId?.[id]?.projectionValues ?? sessions?.projectionsBySession?.[id]?.values)?.agentPreset

      const run = async (operation) => {
        const result = await operation()
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        return result.value
      }
      const mountedRef = React.useRef(true)
      const requestSeqRef = React.useRef(0)
      React.useEffect(() => () => { mountedRef.current = false }, [])

      const loadSnapshot = async (showLoading) => {
        const seq = requestSeqRef.current + 1
        requestSeqRef.current = seq
        if (showLoading) setLoading(true)
        setError(null)
        try {
          const next = await run(() => props.auth.list())
          if (!mountedRef.current || seq !== requestSeqRef.current) return
          setPairs(next.pairs)
          setPendingGrants(next.pending)
        } catch (failure) {
          if (!mountedRef.current || seq !== requestSeqRef.current) return
          setError(`${t('panel.error')}: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          if (mountedRef.current && seq === requestSeqRef.current) setLoading(false)
        }
      }

      React.useEffect(() => {
        void loadSnapshot(true)
        const onChanged = () => { void loadSnapshot(false) }
        window.addEventListener('dsh-collab-auth-changed', onChanged)
        return () => { window.removeEventListener('dsh-collab-auth-changed', onChanged) }
      }, [])

      const rootIds = sorted.map(summary => summary.id).join('|')
      React.useEffect(() => {
        setSelected(current => current.filter(id => sorted.some(summary => summary.id === id)))
      }, [rootIds])

      const toggle = (id) => {
        setNotice(null)
        setError(null)
        setConfirmRevoke(null)
        setSelected(current => current.includes(id)
          ? current.filter(item => item !== id)
          : (current.length >= 2 ? [current[1], id] : [...current, id]))
      }

      const authorize = async () => {
        setConfirmRevoke(null)
        if (selected.length !== 2) {
          setError(t('panel.selectTwo'))
          return
        }
        if (!selected.every(id => sorted.some(summary => summary.id === id))) {
          setSelected([])
          setError(t('panel.selectTwo'))
          return
        }
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const next = await run(() => props.auth.authorize(selected[0], selected[1]))
          setPairs(next.pairs)
          setPendingGrants(next.pending)
          setSelected([])
          setActiveTab('pairs')
          setNotice(t('panel.authorizedNotice'))
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('dsh-collab-auth-changed'))
        } catch (failure) {
          setError(`${t('panel.error')}: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const revoke = async (pair) => {
        setConfirmRevoke(null)
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const next = await run(() => props.auth.revoke(pair.a, pair.b))
          setPairs(next.pairs)
          setPendingGrants(next.pending)
          setNotice(t('panel.revokedNotice'))
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('dsh-collab-auth-changed'))
        } catch (failure) {
          setError(`${t('panel.error')}: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const authorizePair = async (a, b) => {
        setConfirmRevoke(null)
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const next = await run(() => props.auth.authorize(a, b))
          setPairs(next.pairs)
          setPendingGrants(next.pending)
          setActiveTab('pairs')
          setNotice(t('panel.authorizedNotice'))
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('dsh-collab-auth-changed'))
        } catch (failure) {
          setError(`${t('panel.error')}: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const refresh = async () => {
        setConfirmRevoke(null)
        await loadSnapshot(true)
      }

      const hint = loading
        ? t('panel.loading')
        : (selected.length === 2 ? null : t('panel.selectTwo'))

      const visiblePairs = pairs.filter(pair => (
        sorted.some(summary => summary.id === pair.a)
        && sorted.some(summary => summary.id === pair.b)
      ))
      const visiblePending = pendingGrants.filter(grant => (
        sorted.some(summary => summary.id === grant.from)
        && sorted.some(summary => summary.id === grant.to)
      ))
      const pairRows = visiblePairs.map(pair => h('div', {
        key: `${pair.a}|${pair.b}`,
        className: 'dsh-collab-auth-row',
      },
      h('span', { className: 'dsh-collab-auth-pair' },
        h('span', null, titleOf(pair.a)),
        h('span', { className: 'dsh-collab-auth-muted' }, '  ↔  '),
        h('span', null, titleOf(pair.b))),
      h('code', { className: 'dsh-collab-auth-id' }, `${shortId(pair.a)} ↔ ${shortId(pair.b)}`),
      h('button', {
        type: 'button',
        className: 'dsh-collab-auth-button',
        'data-danger': confirmRevoke === `pair:${pair.a}|${pair.b}` ? 'true' : 'false',
        disabled: busy,
        onClick: () => {
          const key = `pair:${pair.a}|${pair.b}`
          if (confirmRevoke !== key) { setConfirmRevoke(key); return }
          void revoke(pair)
        },
      }, confirmRevoke === `pair:${pair.a}|${pair.b}` ? t('panel.confirmRevoke') : t('panel.revoke'))))

      const pendingRows = visiblePending.map(grant => h('div', {
        key: `pending:${grant.from}|${grant.to}`,
        className: 'dsh-collab-auth-row',
      },
      h('span', { className: 'dsh-collab-auth-pair' }, `${titleOf(grant.from)} → ${titleOf(grant.to)}`),
      h('code', { className: 'dsh-collab-auth-id' }, `${shortId(grant.from)} → ${shortId(grant.to)}`),
      h('span', { className: 'dsh-collab-auth-badge' }, t('panel.oneSided')),
      h('button', {
        type: 'button',
        className: 'dsh-collab-auth-button',
        disabled: busy,
        onClick: () => { void authorizePair(grant.from, grant.to) },
      }, t('panel.complete')),
      h('button', {
        type: 'button',
        className: 'dsh-collab-auth-button',
        'data-danger': confirmRevoke === `pending:${grant.from}|${grant.to}` ? 'true' : 'false',
        disabled: busy,
        onClick: () => {
          const key = `pending:${grant.from}|${grant.to}`
          if (confirmRevoke !== key) { setConfirmRevoke(key); return }
          void revoke({ a: grant.from, b: grant.to })
        },
      }, confirmRevoke === `pending:${grant.from}|${grant.to}` ? t('panel.confirmRevoke') : t('panel.revoke'))))

      const sessionRows = sorted.length === 0
        ? [h('p', { key: 'empty', className: 'dsh-collab-auth-muted' }, t('panel.emptySessions'))]
        : sorted.map(summary => h('label', {
            key: summary.id,
            className: 'dsh-collab-auth-row',
            'data-collab-preset': presetOf(summary.id) ?? '',
          },
          h('input', {
            type: 'checkbox',
            checked: selected.includes(summary.id),
            onChange: () => toggle(summary.id),
          }),
          h('span', { className: 'dsh-collab-auth-title-cell' }, summary.displayTitle),
          h('code', { className: 'dsh-collab-auth-id' }, shortId(summary.id)),
          typeof presetOf(summary.id) === 'string' && presetOf(summary.id).length > 0
            ? h('span', { className: 'dsh-collab-auth-badge' }, presetOf(summary.id))
            : null,
          summary.running ? h('span', { className: 'dsh-collab-auth-dot', title: t('panel.running') }) : null))

      const pairCard = h('section', {
        className: 'dsh-collab-auth-card',
        'data-pairs': 'true',
        role: 'tabpanel',
        id: 'dsh-collab-auth-panel-pairs',
        'aria-labelledby': 'dsh-collab-auth-tab-pairs',
      },
      h('div', { className: 'dsh-collab-auth-list' },
        loading ? h('p', { className: 'dsh-collab-auth-muted' }, t('panel.loading')) : null,
        !loading && visiblePairs.length === 0 && visiblePending.length === 0
          ? h('p', { className: 'dsh-collab-auth-muted' }, t('panel.emptyPairs'))
          : null,
        ...pairRows,
        pendingRows.length === 0
          ? null
          : h('p', { className: 'dsh-collab-auth-muted', style: { marginTop: 6 } }, t('panel.pending')),
        ...pendingRows))

      const sessionCard = h('section', {
        className: 'dsh-collab-auth-card',
        'data-grow': 'true',
        role: 'tabpanel',
        id: 'dsh-collab-auth-panel-sessions',
        'aria-labelledby': 'dsh-collab-auth-tab-sessions',
      },
      h('div', { className: 'dsh-collab-auth-list' }, ...sessionRows),
      h('div', { className: 'dsh-collab-auth-footer' },
        hint === null ? null : h('span', { className: 'dsh-collab-auth-hint' }, hint),
        h('span', { className: 'dsh-collab-auth-id' }, `${selected.length}/2`),
        h('button', {
          type: 'button',
          className: 'dsh-collab-auth-button',
          'data-primary': 'true',
          disabled: busy || selected.length !== 2,
          onClick: () => { void authorize() },
        }, t('panel.authorize'))))

      const tabButton = (id, label, count) => h('button', {
        type: 'button',
        role: 'tab',
        id: `dsh-collab-auth-tab-${id}`,
        'aria-controls': `dsh-collab-auth-panel-${id}`,
        className: 'dsh-collab-auth-tab',
        'data-active': activeTab === id ? 'true' : 'false',
        'aria-selected': activeTab === id ? 'true' : 'false',
        onClick: () => setActiveTab(id),
        onKeyDown: (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const next = activeTab === 'pairs' ? 'sessions' : 'pairs'
          setActiveTab(next)
          window.requestAnimationFrame(() => {
            document.getElementById(`dsh-collab-auth-tab-${next}`)?.focus()
          })
        },
      }, `${label} (${String(count)})`)

      return h('div', { className: 'dsh-collab-auth' },
        h('style', null, AUTH_CSS),
        h('div', { className: 'dsh-collab-auth-head' },
          h('h2', { className: 'dsh-collab-auth-title' }, t('panel.title')),
          h('p', { className: 'dsh-collab-auth-desc' }, t('panel.description'))),
        h('div', { className: 'dsh-collab-auth-tabs-row' },
          h('div', { className: 'dsh-collab-auth-tabs', role: 'tablist' },
            tabButton('pairs', t('panel.pairsTab'), visiblePairs.length),
            tabButton('sessions', t('panel.sessionsTab'), sorted.length)),
          h('div', { className: 'dsh-collab-auth-tabs-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-collab-auth-button',
              disabled: loading || busy,
              onClick: () => { void refresh() },
            }, t('panel.refresh')))),
        h('div', { className: 'dsh-collab-auth-body' },
          h('div', { className: 'dsh-collab-auth-content' },
            activeTab === 'pairs' ? pairCard : sessionCard)),
        error === null ? null : h('p', { className: 'dsh-collab-auth-error', role: 'alert' }, error),
        notice === null ? null : h('p', { className: 'dsh-collab-auth-notice', role: 'status' }, notice))
    }

    const REFUSED_CSS = [
      '.dsh-collab-refused{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 2px;padding:10px 12px;border:0.5px solid var(--dsw-alias-state-error-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-error-primary);font-size:13px;font-weight:600;line-height:20px}',
      '.dsh-collab-refused-text{flex:1 1 240px;min-width:0}',
      '.dsh-collab-refused-button{flex:none;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-collab-refused-button:hover{opacity:.9}',
    ].join('')

    function resultText(message) {
      const blocks = Array.isArray(message?.content) ? message.content : []
      return blocks
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
    }

    /** Accumulate one collab_send authorization refusal against its Turn. */
    const collabAuthRefusedDefinition = {
      kind: 'collab-auth-refused',
      match(event) {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
        if (event.type === 'tool/result') return { id: String(event.data.turn), role: 'update' }
        return null
      },
      start(_context, match) {
        if (match.event.type !== 'turn/start') throw new Error('collab-auth-refused start requires turn/start')
        return { turn: match.event.data.turn, calls: new Map(), message: null }
      },
      update(context, match) {
        if (context.state === undefined) return context.state
        if (match.event.type === 'tool/call') {
          const calls = new Map(context.state.calls)
          calls.set(String(match.event.data.callId), match.event.data.name)
          return { ...context.state, calls }
        }
        if (match.event.type !== 'tool/result') return context.state
        const callId = String(match.event.data.message.source.callId)
        if (context.state.calls.get(callId) !== 'collab_send') return context.state
        const text = resultText(match.event.data.message)
        if (!text.includes('未授权') && !text.includes('授权双方')) return context.state
        return { ...context.state, message: text }
      },
      buildLocationData(context, scope, previous) {
        if (scope !== 'turn' || context.state?.message == null) return null
        if (previous?.kind === 'turn'
          && previous.turn === context.state.turn
          && previous.key === 'collab-auth-refused'
          && previous.value.message === context.state.message) return previous
        return {
          kind: 'turn',
          turn: context.state.turn,
          key: 'collab-auth-refused',
          value: { message: context.state.message },
        }
      },
    }

    function CollabAuthRefusedTail(props) {
      const data = props.turn?.data?.get('collab-auth-refused')
      if (data === undefined) return null
      return h(React.Fragment, null,
        h('style', null, REFUSED_CSS),
        h('div', { className: 'dsh-collab-refused', role: 'status' },
          h('span', { className: 'dsh-collab-refused-text' }, `⚠️ ${data.message}`),
          h('button', {
            type: 'button',
            className: 'dsh-collab-refused-button',
            onClick: () => { props.openAuth() },
          }, props.t('auth.open'))))
    }

    const COPY_SESSION_CSS = [
      '.dsh-collab-copy-session{appearance:none;display:flex;flex:none;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;font-size:12px;line-height:1}',
      '.dsh-collab-copy-session:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '.dsh-collab-copy-session[data-copied="true"]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}',
    ].join('')

    async function copySessionName(text) {
      const value = typeof text === 'string' ? text : ''
      try {
        await navigator.clipboard.writeText(value)
        return true
      } catch { /* fall through to the legacy copy path */ }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const copied = document.execCommand('copy')
        area.remove()
        return copied
      } catch {
        return false
      }
    }

    function CollabCopySessionAction(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const [state, setState] = React.useState('idle')
      const title = typeof props.displayTitle === 'string' ? props.displayTitle : ''
      const onClick = async (event) => {
        event.stopPropagation()
        const copied = await copySessionName(title)
        setState(copied ? 'done' : 'failed')
        window.setTimeout(() => setState('idle'), 1400)
      }
      return h('button', {
        type: 'button',
        className: 'dsh-collab-copy-session',
        'data-copied': state === 'done' ? 'true' : 'false',
        title: state === 'done' ? t('copy.done') : (state === 'failed' ? t('copy.failed') : t('copy.title')),
        'aria-label': t('copy.title'),
        onClick,
        onPointerDown: (event) => event.stopPropagation(),
      },
      IconCopyOutlineRegular === undefined ? '⧉' : h(IconCopyOutlineRegular, { size: 14 }))
    }

    function CollabCopySessionMenuItem(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const [, setMenuOpen] = props.useMenuOpenState()
      const copy = () => {
        setMenuOpen(false)
        void copySessionName(typeof props.displayTitle === 'string' ? props.displayTitle : '')
      }
      return typeof MenuItemButton === 'function'
        ? h(MenuItemButton, { onSelect: copy }, h('span', null, t('copy.title')))
        : h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsh-collab-menu-item',
            onClick: copy,
          }, t('copy.title'))
    }

    function CollabCopySessionStyles() {
      return h('style', null, COPY_SESSION_CSS)
    }

    const BASE_MAX = 16 * 1024
    const basePromptStore = {
      open: false,
      sessionId: null,
      sessionTitle: '',
      value: '',
      loading: false,
      saving: false,
      error: null,
      listeners: new Set(),
    }
    let executeBasePromptCommand = null

    const BASE_CSS = [
      '.dsh-collab-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}',
      '.dsh-collab-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-collab-base-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,.38);pointer-events:auto}',
      '.dsh-collab-base-dialog{display:flex;flex-direction:column;gap:12px;width:min(620px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:20px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 18px 60px rgba(0,0,0,.28)}',
      '.dsh-collab-base-title{margin:0;font-size:16px;line-height:22px;font-weight:600}',
      '.dsh-collab-base-desc{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dsh-collab-base-session{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dsh-collab-base-textarea{width:100%;min-height:180px;max-height:45vh;box-sizing:border-box;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;resize:vertical;outline:none}',
      '.dsh-collab-base-textarea:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-collab-base-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}',
      '.dsh-collab-base-button{height:30px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-collab-base-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-collab-base-button:disabled{opacity:.45;cursor:default}',
      '.dsh-collab-base-button[data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.dsh-collab-base-button[data-primary="true"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));color:var(--dsw-alias-bg-base)}',
      '.dsh-collab-base-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
      '.dsh-collab-base-loading{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
    ].join('')

    function setBasePromptExecutor(executor) {
      executeBasePromptCommand = executor
    }

    function emitBasePrompt() {
      for (const listener of basePromptStore.listeners) listener()
    }

    function updateBasePromptState(patch) {
      Object.assign(basePromptStore, patch)
      emitBasePrompt()
    }

    function useBasePromptState() {
      const [state, setState] = React.useState(() => ({ ...basePromptStore }))
      React.useEffect(() => {
        const update = () => setState({ ...basePromptStore })
        basePromptStore.listeners.add(update)
        update()
        return () => { basePromptStore.listeners.delete(update) }
      }, [])
      return state
    }

    function encodeBasePrompt(text) {
      const bytes = new TextEncoder().encode(text)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    }

    function parseBasePromptResult(result) {
      if (result === undefined || result.ok !== true) {
        const message = result?.error?.message ?? 'command failed'
        throw new Error(message)
      }
      const execution = result.value
      if (execution === undefined) throw new Error('command unavailable')
      if (execution.result?.kind === 'error') throw new Error(execution.result.text)
      const text = execution.result?.text
      if (typeof text !== 'string' || text.length === 0) throw new Error('empty command result')
      const data = JSON.parse(text)
      return typeof data.basePrompt === 'string' ? data.basePrompt : ''
    }

    function parseBasePromptCommand(line) {
      if (line === '/collab-base get') return { operation: 'baseGet' }
      const match = /^\/collab-base set(?: (.*))?$/u.exec(line)
      if (match === null) return null
      const encoded = match[1] ?? ''
      try {
        const binary = atob(encoded)
        const value = new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
        return { operation: 'baseSet', value }
      } catch {
        return null
      }
    }

    const capabilityDetailStore = {
      open: false,
      sessionId: null,
      relationship: null,
      busy: false,
      error: null,
      listeners: new Set(),
    }
    let executeLinkCommand = null

    const CAP_DETAIL_CSS = [
      '.dsh-collab-cap-field{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.dsh-collab-cap-label{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;text-transform:uppercase;letter-spacing:.04em}',
      '.dsh-collab-cap-value{font-size:12px;line-height:18px;word-break:break-word}',
      '.dsh-collab-cap-desc{margin:0;padding:10px 12px;max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;font-size:12px;line-height:18px}',
      '.dsh-collab-cap-head{display:flex;align-items:flex-start;gap:8px}',
      '.dsh-collab-cap-head .dsh-collab-base-title{flex:1;min-width:0}',
      '.dsh-collab-cap-tools{display:flex;align-items:center;gap:8px}',
      '.dsh-collab-cap-search{flex:1;min-width:0;height:30px;padding:0 10px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}',
      '.dsh-collab-cap-search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-collab-cap-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}',
      '.dsh-collab-cap-desc{max-height:40vh;overflow:auto}',
      '.dsh-collab-cap-desc[data-collapsed="true"]{max-height:112px;overflow:hidden;mask-image:linear-gradient(to bottom,black 68%,transparent)}',
      '.dsh-collab-cap-desc mark{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-radius:2px}',
    ].join('')

    function setLinkExecutor(executor) {
      executeLinkCommand = executor
    }

    function emitCapabilityDetail() {
      for (const listener of capabilityDetailStore.listeners) listener()
    }

    function updateCapabilityDetail(patch) {
      Object.assign(capabilityDetailStore, patch)
      emitCapabilityDetail()
    }

    function useCapabilityDetailState() {
      const [state, setState] = React.useState(() => ({ ...capabilityDetailStore }))
      React.useEffect(() => {
        const update = () => setState({ ...capabilityDetailStore })
        capabilityDetailStore.listeners.add(update)
        update()
        return () => { capabilityDetailStore.listeners.delete(update) }
      }, [])
      return state
    }

    function openCapabilityDetail(sessionId, relationship) {
      updateCapabilityDetail({
        open: true,
        sessionId,
        relationship,
        busy: false,
        error: null,
      })
    }

    function closeCapabilityDetail() {
      updateCapabilityDetail({
        open: false,
        sessionId: null,
        relationship: null,
        busy: false,
        error: null,
      })
    }

    function useDialogFocus(dialogRef, open, close, blocked) {
      React.useEffect(() => {
        if (!open) return undefined
        const previous = document.activeElement
        const dialog = dialogRef.current
        const focusable = () => dialog === null ? []
          : [...dialog.querySelectorAll('button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])')]
        const first = focusable()[0]
        if (first !== undefined) first.focus()
        else dialog?.focus?.()
        const onKey = (event) => {
          if (event.key === 'Escape') {
            if (blocked) return
            event.preventDefault()
            close()
            return
          }
          if (event.key !== 'Tab') return
          const items = focusable()
          if (items.length === 0) {
            event.preventDefault()
            dialog?.focus?.()
            return
          }
          const current = document.activeElement
          const index = items.indexOf(current)
          const next = event.shiftKey
            ? (index <= 0 ? items[items.length - 1] : items[index - 1])
            : (index < 0 || index === items.length - 1 ? items[0] : items[index + 1])
          event.preventDefault()
          next.focus()
        }
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('keydown', onKey)
          if (previous !== null && typeof previous.focus === 'function') previous.focus()
        }
      }, [open, blocked, close])
    }

    function CollabCapabilityDetailOverlay(props) {
      const state = useCapabilityDetailState()
      const dialogRef = React.useRef(null)
      React.useEffect(() => {
        if (!state.open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape' && !state.busy) closeCapabilityDetail()
        }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [state.open, state.busy])
      const [query, setQuery] = React.useState('')
      const [expanded, setExpanded] = React.useState(false)
      React.useEffect(() => {
        if (!state.open) return
        const description = state.relationship?.capability?.description ?? ''
        setQuery('')
        setExpanded(description.length <= 320)
      }, [state.open, state.relationship?.worker])
      if (!state.open || state.relationship === null) return null
      const relationship = state.relationship
      const capability = relationship.capability
      const pinned = capability?.source === 'override'
      const rawDescription = capability?.description ?? ''
      const queryText = query.trim()
      const lowerDescription = rawDescription.toLocaleLowerCase()
      const lowerQuery = queryText.toLocaleLowerCase()
      const segments = []
      let matchCount = 0
      if (lowerQuery.length > 0 && rawDescription.length > 0) {
        let cursor = 0
        while (matchCount < 500) {
          const index = lowerDescription.indexOf(lowerQuery, cursor)
          if (index < 0) break
          if (index > cursor) segments.push(rawDescription.slice(cursor, index))
          segments.push(h('mark', { key: `m-${String(matchCount)}` }, rawDescription.slice(index, index + queryText.length)))
          matchCount += 1
          cursor = index + queryText.length
        }
        if (cursor < rawDescription.length) segments.push(rawDescription.slice(cursor))
      }
      const canCollapse = rawDescription.length > 320 || rawDescription.split('\n').length > 6
      const collapsed = canCollapse && !expanded && queryText.length === 0
      const descriptionBody = queryText.length === 0
        ? rawDescription
        : (matchCount === 0 ? props.t('board.searchEmpty') : h(React.Fragment, null, ...segments))
      const detailField = (label, value) => h('div', { className: 'dsh-collab-cap-field' },
        h('span', { className: 'dsh-collab-cap-label' }, label),
        value)
      const applyMode = async (action) => {
        updateCapabilityDetail({ busy: true, error: null })
        try {
          if (executeLinkCommand === null) throw new Error('command executor is not ready')
          const result = await executeLinkCommand(state.sessionId, `/collab-link ${action} ${relationship.worker}`)
          if (result === undefined || result.ok !== true) throw new Error(result?.error?.message ?? 'command failed')
          if (result.value?.result?.kind === 'error') throw new Error(result.value.result.text)
          closeCapabilityDetail()
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dsh-collab-board-refresh', { detail: { action, worker: relationship.worker } }))
          }
        } catch (error) {
          updateCapabilityDetail({ busy: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return h(React.Fragment, null,
        h('style', null, BASE_CSS + CAP_DETAIL_CSS),
        h('div', {
          className: 'dsh-collab-base-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !state.busy) closeCapabilityDetail()
          },
        },
        h('div', {
          ref: dialogRef,
          tabIndex: -1,
          className: 'dsh-collab-base-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsh-collab-cap-title',
        },
        h('div', { className: 'dsh-collab-cap-head' },
          h('h2', { id: 'dsh-collab-cap-title', className: 'dsh-collab-base-title' },
            capability?.name ?? shortId(relationship.worker))),
        detailField(props.t('board.workerId'), h('code', { className: 'dsh-collab-cap-value' }, relationship.worker)),
        detailField(props.t('board.source'), h('span', { className: 'dsh-collab-cap-value' },
          pinned ? props.t('board.sourceOverride') : props.t('board.sourceLive'),
          capability?.changed === true
            ? h('span', { className: 'dsh-collab-board-status', 'data-warn': 'true', style: { marginLeft: 6 } }, props.t('board.changed'))
            : null)),
        detailField(props.t('board.version'), h('code', { className: 'dsh-collab-cap-value' }, capability?.version ?? '-')),

        detailField(props.t('board.description'),
          h(React.Fragment, null,
            rawDescription.length === 0
              ? h('p', { className: 'dsh-collab-cap-desc' }, props.t('board.noDescription'))
              : h(React.Fragment, null,
                  h('div', { className: 'dsh-collab-cap-tools' },
                    h('input', {
                      className: 'dsh-collab-cap-search',
                      type: 'search',
                      value: query,
                      placeholder: props.t('board.search'),
                      onChange: (event) => setQuery(event.target.value),
                    }),
                    queryText.length === 0
                      ? null
                      : h('span', { className: 'dsh-collab-cap-count' }, `${String(matchCount)}`),
                    canCollapse && queryText.length === 0
                      ? h('button', {
                          type: 'button',
                          className: 'dsh-collab-base-button',
                          onClick: () => setExpanded(value => !value),
                        }, expanded ? props.t('board.collapse') : props.t('board.expand'))
                      : null),
                  h('pre', { className: 'dsh-collab-cap-desc', 'data-collapsed': collapsed ? 'true' : 'false' }, descriptionBody)))),
        state.error === null
          ? null
          : h('p', { className: 'dsh-collab-base-error', role: 'alert' }, state.error),
        h('div', { className: 'dsh-collab-base-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-collab-base-button',
            disabled: state.busy || pinned,
            onClick: () => { void applyMode('pin') },
          }, props.t('board.pin')),
          h('button', {
            type: 'button',
            className: 'dsh-collab-base-button',
            'data-primary': 'true',
            disabled: state.busy || !pinned,
            onClick: () => { void applyMode('live') },
          }, props.t('board.useLive')),
          h('button', {
            type: 'button',
            className: 'dsh-collab-base-button',
            disabled: state.busy,
            onClick: closeCapabilityDetail,
          }, props.t('board.close'))))))
    }

    async function loadBasePrompt(sessionId) {
      if (executeBasePromptCommand === null) throw new Error('command executor is not ready')
      const result = await executeBasePromptCommand(sessionId, '/collab-base get')
      return parseBasePromptResult(result)
    }

    async function openBasePromptEditor(sessionId, sessionTitle) {
      updateBasePromptState({
        open: true,
        sessionId,
        sessionTitle: typeof sessionTitle === 'string' ? sessionTitle : '',
        value: '',
        loading: true,
        saving: false,
        error: null,
      })
      try {
        const value = await loadBasePrompt(sessionId)
        if (basePromptStore.open && basePromptStore.sessionId === sessionId) {
          updateBasePromptState({ value, loading: false })
        }
      } catch (error) {
        if (basePromptStore.open && basePromptStore.sessionId === sessionId) {
          updateBasePromptState({ loading: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    function closeBasePromptEditor() {
      updateBasePromptState({ open: false, sessionId: null, sessionTitle: '', value: '', loading: false, saving: false, error: null })
    }

    async function writeBasePrompt(sessionId, value) {
      if (executeBasePromptCommand === null) throw new Error('command executor is not ready')
      const encoded = encodeBasePrompt(value)
      const result = await executeBasePromptCommand(sessionId, `/collab-base set ${encoded}`)
      return parseBasePromptResult(result)
    }

    async function saveBasePromptEditor() {
      const sessionId = basePromptStore.sessionId
      if (sessionId === null) return
      updateBasePromptState({ saving: true, error: null })
      try {
        await writeBasePrompt(sessionId, basePromptStore.value)
        if (basePromptStore.open && basePromptStore.sessionId === sessionId) {
          updateBasePromptState({ open: false, saving: false, sessionId: null, sessionTitle: '', value: '' })
        }
      } catch (error) {
        updateBasePromptState({
          saving: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    function CollabBasePromptEditor(props) {
      const state = useBasePromptState()
      const dialogRef = React.useRef(null)
      useDialogFocus(dialogRef, state.open, closeBasePromptEditor, state.saving)
      if (!state.open) return null
      return h(React.Fragment, null,
        h('style', null, BASE_CSS),
        h('div', {
          className: 'dsh-collab-base-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !state.saving) closeBasePromptEditor()
          },
        },
        h('div', {
          ref: dialogRef,
          tabIndex: -1,
          className: 'dsh-collab-base-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsh-collab-base-title',
          'aria-describedby': 'dsh-collab-base-desc',
        },
        h('h2', { id: 'dsh-collab-base-title', className: 'dsh-collab-base-title' }, props.t('base.title')),
        state.sessionTitle.length === 0
          ? null
          : h('p', { className: 'dsh-collab-base-session' }, `${props.t('base.session')}: ${state.sessionTitle}`),
        h('p', { id: 'dsh-collab-base-desc', className: 'dsh-collab-base-desc' }, props.t('base.description')),
        state.loading
          ? h('p', { className: 'dsh-collab-base-loading' }, props.t('base.loading'))
          : h('textarea', {
              className: 'dsh-collab-base-textarea',
              value: state.value,
              maxLength: BASE_MAX,
              rows: 9,
              autoFocus: true,
              placeholder: props.t('base.placeholder'),
              onChange: (event) => { updateBasePromptState({ value: event.target.value }) },
            }),
        state.error === null
          ? null
          : h('p', { className: 'dsh-collab-base-error', role: 'alert' },
              `${props.t('base.error')}: ${state.error}`),
        h('div', { className: 'dsh-collab-base-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-collab-base-button',
            onClick: closeBasePromptEditor,
          }, props.t('base.cancel')),
          h('button', {
            type: 'button',
            className: 'dsh-collab-base-button',
            'data-primary': 'true',
            disabled: state.loading || state.saving,
            onClick: () => { void saveBasePromptEditor() },
          }, state.saving ? props.t('base.saving') : props.t('base.save'))))))
    }

    function CollabBasePromptMenuItem(props) {
      const sessions = props.useSessions(selectSnapshot)
      const summary = sessions.byId[props.sessionId]
      const [, setMenuOpen] = props.useMenuOpenState()
      if (!isCollabSummary(summary, sessions)) return null
      const select = () => {
        setMenuOpen(false)
        void openBasePromptEditor(props.sessionId, props.displayTitle || summary?.displayTitle || props.sessionId)
      }
      return typeof MenuItemButton === 'function'
        ? h(MenuItemButton, { onSelect: select }, h('span', null, props.t('base.menu')))
        : h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsh-collab-menu-item',
            onClick: select,
          }, props.t('base.menu'))
    }

    const BOARD_CSS = [
      '.dsh-collab-board{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;overflow-y:auto;padding:12px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}',
      '.dsh-collab-board-head{display:flex;align-items:center;justify-content:flex-start;gap:10px}',
      '.dsh-collab-board-title{margin:0;font-size:14px;line-height:20px;font-weight:600}',
      '.dsh-collab-board-section{display:flex;flex-direction:column;gap:6px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px}',
      '.dsh-collab-board-section-title{margin:0;font-size:12px;font-weight:600}',
      '.dsh-collab-board-muted{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;margin:0}',
      '.dsh-collab-board-row{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;min-width:0}',
      '.dsh-collab-board-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-collab-board-row[data-selected="true"]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));outline:0.5px solid var(--dsw-alias-border-l2);outline-offset:-0.5px}',
      '.dsh-collab-board-row[data-clickable="true"]{cursor:pointer}',
      '.dsh-collab-board-locate{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '[data-collab-focus="true"]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:8px;transition:outline-color .2s ease}',
      '.dsh-collab-board-row-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-collab-board-id{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--dsh-font-mono,monospace);font-size:10px}',
      '.dsh-collab-board-status{flex:none;padding:0 6px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px}',
      '.dsh-collab-board-status[data-warn="true"]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-brand-primary));border-color:currentColor}',
      '.dsh-collab-board-button{flex:none;height:24px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}',
      '.dsh-collab-board-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
      '.dsh-collab-board-button:disabled{opacity:.45;cursor:default}',
      '.dsh-collab-board-button[data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.dsh-collab-board-button[data-primary="true"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));color:var(--dsw-alias-bg-base)}',
      '.dsh-collab-board-input,.dsh-collab-board-select,.dsh-collab-board-textarea{width:100%;box-sizing:border-box;padding:6px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;outline:none}',
      '.dsh-collab-board-textarea{min-height:48px;resize:vertical}',
      '.dsh-collab-board-form{display:flex;flex-direction:column;gap:6px}',
      '.dsh-collab-board-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}',
      '.dsh-collab-board-actions[data-align="start"]{justify-content:flex-start}',
      '.dsh-collab-board-open{appearance:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;padding:2px 6px;cursor:pointer}',
      '.dsh-collab-board-open:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}',
      '.dsh-collab-board-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}',
      '.dsh-collab-board-notice{margin:0;padding:6px 8px;border:0.5px solid var(--dsw-alias-state-success-primary,var(--dsw-alias-border-l2));border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary));font-size:11px;line-height:16px}',
    ].join('')

    function isSupervisorSessionSummary(summary, state) {
      const values = summary?.projectionValues ?? state?.projectionsBySession?.[summary?.id]?.values
      return values?.agentPreset === 'supervisor'
    }

    /** Best-effort turn lookup for tasks created before turn recording. */
    function taskTurnFromChat(chat, task) {
      if (chat === undefined || chat === null) return null
      const nodes = typeof chat.nodes?.values === 'function' ? chat.nodes.values() : []
      let found = null
      for (const node of nodes) {
        if (node?.kind !== 'tool-call') continue
        const root = node.data?.root
        const raw = typeof root?.call?.argsRaw === 'string'
          ? root.call.argsRaw
          : (typeof root?.argsRaw === 'string' ? root.argsRaw : '')
        if (raw.length === 0 || typeof root?.turn !== 'number') continue
        const idMatch = raw.match(/"taskId"\s*:\s*"([^"]+)"/u)
        if (idMatch?.[1] !== task.id && !raw.includes(JSON.stringify(task.title))) continue
        found = root.turn
      }
      return found
    }

    function SupervisorBoardTab(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const mode = props.mode === 'workers' ? 'workers' : 'tasks'
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const noticeTimerRef = React.useRef(null)
      const [requestPage, setRequestPage] = React.useState(0)
      const [selectedRequestId, setSelectedRequestId] = React.useState(null)
      const chat = typeof props.useChat === 'function' ? props.useChat(snapshot => snapshot) : undefined

      const load = async () => {
        setLoading(true)
        setError(null)
        try {
          const result = await props.panel(props.sessionId, 'board', {})
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          setData(JSON.parse(result.value))
        } catch (failure) {
          setError(`${t('board.error')}: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          setLoading(false)
        }
      }

      React.useEffect(() => { void load() }, [props.sessionId])

      React.useEffect(() => {
        const reload = (event) => {
          const action = event?.detail?.action
          if (action === 'pin') setNotice(t('board.pinnedNotice'))
          else if (action === 'live') setNotice(t('board.liveNotice'))
          if (action !== undefined) {
            if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
            noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2600)
          }
          void load()
        }
        window.addEventListener('dsh-collab-board-refresh', reload)
        return () => { window.removeEventListener('dsh-collab-board-refresh', reload) }
      }, [props.sessionId])

      const offer = async (entry) => {
        setBusy(true)
        setError(null)
        try {
          const result = await props.panel(props.sessionId, 'link', { worker: entry.sessionId, payload: { offer: true } })
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('dsh-collab-auth-changed'))
          await load()
        } catch (failure) {
          setError(`${t('board.error')}: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const unlink = async (workerId) => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('board.confirmUnlink'))) return
        setBusy(true)
        setError(null)
        try {
          const result = await props.panel(props.sessionId, 'unlink', { worker: workerId })
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('dsh-collab-auth-changed'))
          await load()
        } catch (failure) {
          setError(`${t('board.error')}: ${failure instanceof Error ? failure.message : String(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const workers = data?.workers ?? []
      const linked = (data?.relationships ?? []).filter(rel => rel.offer === true)
      const available = workers.filter(entry => !linked.some(rel => rel.worker === entry.sessionId))
      const subtasks = data?.tasks ?? []
      const parentTasks = data?.tasks ?? []
      const requests = data?.requests ?? []
      const statusText = (status) => {
        const key = `status.${String(status)}`
        const localized = t(key)
        return localized === key ? String(status) : localized
      }
      const requestPageCount = Math.max(1, Math.ceil(requests.length / 5))
      const safeRequestPage = Math.min(requestPage, requestPageCount - 1)
      const pageRequests = requests.slice(
        safeRequestPage * 5,
        safeRequestPage * 5 + 5,
      )
      const pageRequestIds = pageRequests.map(request => request.id).join('\u0000')
      const selectedRequest = requests.find(request => request.id === selectedRequestId)
        ?? pageRequests[0]
        ?? null
      const selectedParentTask = selectedRequest === null
        ? null
        : (parentTasks.find(task => task.id === (selectedRequest.taskId ?? selectedRequest.projectId))
          ?? parentTasks.find(task => task.requestId === selectedRequest.id)
          ?? null)
      const selectedSubtasks = selectedParentTask === null
        ? []
        : subtasks.filter(task => (task.taskId ?? task.projectId) === selectedParentTask.id)
      React.useEffect(() => {
        if (requestPage !== safeRequestPage) setRequestPage(safeRequestPage)
      }, [requestPage, safeRequestPage])
      React.useEffect(() => {
        if (pageRequests.length === 0) {
          if (selectedRequestId !== null) setSelectedRequestId(null)
          return
        }
        if (!pageRequests.some(request => request.id === selectedRequestId)) {
          setSelectedRequestId(pageRequests[0].id)
        }
      }, [safeRequestPage, pageRequestIds, selectedRequestId])

      const focusTask = (task) => {
        let turn = Number.isInteger(task.assignedTurn)
          ? task.assignedTurn
          : (Number.isInteger(task.createdTurn) ? task.createdTurn : null)
        if (turn === null) turn = taskTurnFromChat(chat, task)
        if (turn === null) {
          setError(t('board.noLocation'))
          return
        }
        setError(null)
        try { props.openSession?.(props.sessionId) } catch { /* the current session may already be shown */ }
        let settled = false
        const chatScroller = () => {
          const anchor = document.querySelector('[data-turn-process], [data-turn-tail]')
          let node = anchor?.parentElement ?? null
          while (node !== null) {
            const style = window.getComputedStyle(node)
            if (/(auto|scroll)/u.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node
            node = node.parentElement
          }
          return document.scrollingElement
        }
        const nudgeOlderTurns = () => {
          const scroller = chatScroller()
          if (scroller === null) return
          scroller.scrollTop = 0
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
        }
        const reveal = () => {
          if (settled) return
          const processElement = document.querySelector(`[data-turn-process="${turn}"]`)
          const tailElement = document.querySelector(`[data-turn-tail="${turn}"]`)
          const element = processElement !== null && processElement.getClientRects().length > 0
            ? processElement
            : (tailElement ?? processElement)
          if (element === null) {
            // DSH virtualizes long conversations; scrolling to the oldest loaded
            // turn asks the chat pager to render the page that owns this turn.
            nudgeOlderTurns()
            return
          }
          settled = true
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          element.setAttribute('data-collab-focus', 'true')
          window.setTimeout(() => element.removeAttribute('data-collab-focus'), 1500)
        }
        reveal()
        for (const delay of [80, 180, 360, 700, 1200, 1800, 2500]) window.setTimeout(reveal, delay)
        window.setTimeout(() => { if (!settled) setError(t('board.notFound')) }, 3000)
      }

      const headerActions = []
      headerActions.push(h('button', {
        type: 'button',
        className: 'dsh-collab-board-button',
        disabled: loading || busy,
        onClick: () => { void load() },
      }, t('board.refresh')))

      return h('div', { className: 'dsh-collab-board' },
        h('style', null, BOARD_CSS),
        h('div', { className: 'dsh-collab-board-head' },
          h('h2', { className: 'dsh-collab-board-title' }, mode === 'tasks' ? t('board.tasksTitle') : t('board.workersTitle')),
          h('div', { className: 'dsh-collab-board-actions' }, ...headerActions)),
        error === null ? null : h('p', { className: 'dsh-collab-board-error', role: 'alert' }, error),
        notice === null ? null : h('p', { className: 'dsh-collab-board-notice', role: 'status' }, notice),
        loading ? h('p', { className: 'dsh-collab-board-muted' }, t('board.loading')) : null,
        mode === 'workers'
          ? h(React.Fragment, null,
              h('section', { className: 'dsh-collab-board-section' },
                h('h3', { className: 'dsh-collab-board-section-title' }, t('board.workers')),
                linked.length === 0
                  ? h('p', { className: 'dsh-collab-board-muted' }, t('board.emptyWorkers'))
                  : linked.map(rel => h('div', {
                    key: rel.worker,
                    className: 'dsh-collab-board-row',
                    'data-clickable': 'true',
                    role: 'button',
                    tabIndex: 0,
                    title: t('board.viewDetails'),
                    onClick: () => openCapabilityDetail(props.sessionId, rel),
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      openCapabilityDetail(props.sessionId, rel)
                    },
                  },
                    h('span', { className: 'dsh-collab-board-row-main' }, rel.capability?.name ?? shortId(rel.worker)),
                    h('code', { className: 'dsh-collab-board-id' }, shortId(rel.worker)),
                    h('span', { className: 'dsh-collab-board-status' }, 'offer'),
                    h('button', {
                      type: 'button',
                      className: 'dsh-collab-board-button',
                      disabled: busy,
                      onClick: (event) => {
                        event.stopPropagation()
                        void unlink(rel.worker)
                      },
                      onKeyDown: (event) => { event.stopPropagation() },
                    }, t('board.unlink'))))),
              h('section', { className: 'dsh-collab-board-section' },
                h('h3', { className: 'dsh-collab-board-section-title' }, t('board.available')),
                available.length === 0
                  ? h('p', { className: 'dsh-collab-board-muted' }, t('board.emptyAvailable'))
                  : available.map(entry => h('div', { key: entry.sessionId, className: 'dsh-collab-board-row' },
                      h('span', { className: 'dsh-collab-board-row-main' },
                        entry.capability?.name ?? entry.title ?? shortId(entry.sessionId),
                        typeof entry.capability?.description === 'string' && entry.capability.description.trim().length > 0
                          ? h('span', { className: 'dsh-collab-board-muted' }, ` · ${entry.capability.description.trim().slice(0, 120)}`)
                          : null),
                      h('code', { className: 'dsh-collab-board-id' }, shortId(entry.sessionId)),
                      h('button', {
                        type: 'button',
                        className: 'dsh-collab-board-button',
                        'data-primary': 'true',
                        disabled: busy,
                        onClick: () => { void offer(entry) },
                      }, t('board.offer'))))))
          : h(React.Fragment, null,
              h('section', { className: 'dsh-collab-board-section' },
                h('div', { className: 'dsh-collab-board-head' },
                  h('h3', { className: 'dsh-collab-board-section-title' }, t('board.requests')),
                  h('span', { className: 'dsh-collab-board-status' }, String(requests.length))),
                requests.length === 0
                  ? h('p', { className: 'dsh-collab-board-muted' }, t('board.emptyRequests'))
                  : h(React.Fragment, null,
                      h('div', { className: 'dsh-collab-auth-list' },
                        pageRequests.map(request => h('div', {
                          key: request.id,
                          className: 'dsh-collab-board-row',
                          'data-selected': selectedRequest?.id === request.id ? 'true' : undefined,
                          'data-clickable': 'true',
                          role: 'button',
                          tabIndex: 0,
                          onClick: () => setSelectedRequestId(request.id),
                          onKeyDown: (event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            setSelectedRequestId(request.id)
                          },
                        },
                          h('span', { className: 'dsh-collab-board-row-main' },
                            request.title,
                            request.reason === undefined ? null : h('span', { className: 'dsh-collab-board-muted' }, ` · ${request.reason}`)),
                          h('code', { className: 'dsh-collab-board-id' }, request.requesterTitle ?? shortId(request.requester)),
                          h('span', { className: 'dsh-collab-board-status' }, statusText(request.status))))),
                      requestPageCount > 1
                        ? h('div', { className: 'dsh-collab-board-actions', 'data-align': 'start' },
                            h('button', {
                              type: 'button',
                              className: 'dsh-collab-board-button',
                              disabled: safeRequestPage === 0,
                              onClick: () => setRequestPage(page => Math.max(0, page - 1)),
                            }, t('board.prevPage')),
                            h('span', { className: 'dsh-collab-board-muted' }, `${safeRequestPage + 1} / ${requestPageCount}`),
                            h('button', {
                              type: 'button',
                              className: 'dsh-collab-board-button',
                              disabled: safeRequestPage >= requestPageCount - 1,
                              onClick: () => setRequestPage(page => Math.min(requestPageCount - 1, page + 1)),
                            }, t('board.nextPage')))
                        : null)),
              selectedRequest === null
                ? null
                : h('section', { className: 'dsh-collab-board-section' },
                    h('div', { className: 'dsh-collab-board-head' },
                      h('h3', { className: 'dsh-collab-board-section-title' }, selectedRequest.title),
                      h('span', { className: 'dsh-collab-board-status' }, statusText(selectedRequest.status))),
                    h('p', { className: 'dsh-collab-board-muted' },
                      `${t('board.requester')}: ${selectedRequest.requesterTitle ?? shortId(selectedRequest.requester)}`),
                    selectedParentTask === null
                      ? h('p', { className: 'dsh-collab-board-muted' }, t('board.noLinkedTask'))
                      : h(React.Fragment, null,
                          h('div', { className: 'dsh-collab-board-head' },
                            h('h4', { className: 'dsh-collab-board-section-title' }, selectedParentTask.title),
                            h('span', { className: 'dsh-collab-board-status' }, t('board.parentTask')),
                            h('span', { className: 'dsh-collab-board-status' }, statusText(selectedParentTask.status))),
                          selectedSubtasks.length === 0
                            ? h('p', { className: 'dsh-collab-board-muted' }, t('board.emptyTasks'))
                            : selectedSubtasks.map(task => h('div', {
                                key: task.id,
                                className: 'dsh-collab-board-row',
                                'data-clickable': 'true',
                                role: 'button',
                                tabIndex: 0,
                                title: t('board.locate'),
                                onClick: () => focusTask(task),
                                onKeyDown: (event) => {
                                  if (event.key !== 'Enter' && event.key !== ' ') return
                                  event.preventDefault()
                                  focusTask(task)
                                },
                              },
                                h('span', { className: 'dsh-collab-board-row-main' }, task.title),
                                h('span', { className: 'dsh-collab-board-status' }, t('board.subtask')),
                                h('code', { className: 'dsh-collab-board-id' }, ` ${t('board.worker')}: ${task.workerTitle ?? shortId(task.worker ?? '-')}`),
                                h('span', { className: 'dsh-collab-board-locate', 'aria-hidden': 'true' }, '↗'),
                                h('span', { className: 'dsh-collab-board-status' }, statusText(task.status))))),
        )))
    }

    function CollabBoardTabTitle(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const { tab } = props.useTabInfo()
      return h('span', { className: 'dsh-collab-board-tab-title' },
        tab?.kind === WORKERS_TAB_KIND ? t('board.workersTitle') : t('board.tasksTitle'))
    }

    const GUIDE_CARD_CSS = `.F6Huca_guide{--dsl-guide-entry-radius:var(--dsw-radius-xl);box-sizing:border-box;flex-direction:column;justify-content:center;align-items:center;gap:14px;min-height:100%;padding:0 24px;display:flex}.F6Huca_guide:after{content:"";flex:0 10%}.F6Huca_hero{color:var(--dsw-specific-guide-hero);margin-bottom:16px;display:flex}.dsh-collab-guide-entry{box-sizing:border-box;width:380px;max-width:100%;min-height:56px;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsl-guide-entry-radius);cursor:pointer;align-items:center;gap:14px;padding:14px 20px;display:flex}@media (hover:hover){.dsh-collab-guide-entry:hover{background:var(--dsw-alias-interactive-bg-hover)}}.dsh-collab-guide-icon{width:26px;height:26px;color:var(--dsw-alias-label-secondary);flex:none;justify-content:center;align-items:center;display:flex}.F6Huca_placeholderInk{color:var(--dsw-alias-label-tertiary)}.dsh-collab-guide-text{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}.dsh-collab-guide-title{white-space:nowrap;text-overflow:ellipsis;font-size:14px;line-height:1.4;overflow:hidden}.dsh-collab-guide-description{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:1.4;overflow:hidden}.F6Huca_titleIcon{color:var(--dsw-alias-label-tertiary);flex:none}.dsh-collab-guide-cell{width:380px;max-width:100%}.F6Huca_moreAnchor{width:380px;max-width:100%;display:flex}.F6Huca_moreAnchor .dsh-collab-guide-entry[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.F6Huca_moreMenu{width:max-content;max-width:min(480px,100vw - 24px)}`

    function normalizePanelValue(raw) {
      let value = raw
      if (typeof value === 'string') value = JSON.parse(value)
      if (value !== null && typeof value === 'object' && 'ok' in value) {
        if (value.ok === false) throw new Error(value.error?.message ?? 'collaboration Remote failed')
        value = value.value
      }
      if (typeof value === 'string') value = JSON.parse(value)
      return value
    }

    function CollabGuideStyles() {
      return h('style', null, GUIDE_CARD_CSS)
    }

    function boardCounts(data) {
      const relationships = Array.isArray(data?.relationships) ? data.relationships : []
      const tasks = Array.isArray(data?.tasks) ? data.tasks : []
      return {
        registered: relationships.filter(relationship => relationship.offer === true).length,
        activeTasks: tasks.filter(task => task.status === 'open').length,
        totalTasks: tasks.length,
      }
    }

    function CollabGuideCard(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const { tab } = props.useTabInfo()
      const [summary, setSummary] = React.useState('')
      React.useEffect(() => {
        let alive = true
        if (typeof props.loadSummary !== 'function') return undefined
        Promise.resolve(props.loadSummary()).then(raw => {
          if (!alive) return
          const data = normalizePanelValue(raw)
          const counts = boardCounts(data)
          if (props.entryId === 'tasks') {
            setSummary(t('board.tasksGuideCount', { active: counts.activeTasks, total: counts.totalTasks }))
          } else {
            setSummary(t('board.workersGuideCount', { total: counts.registered }))
          }
        }).catch(() => {})
        return () => { alive = false }
      }, [props.sessionId, props.entryId])
      const icon = props.entryId === 'tasks' ? IconChecklistOutlineRegular : IconUserOutlineRegular
      return h('button', {
        type: 'button',
        className: 'dsh-collab-guide-entry',
        'data-sidebar-right-guide-entry': props.kind,
        onClick: () => {
          tab.actions.openTab(props.kind, { replaceTab: true })
          tab.actions.close()
        },
      },
        h('span', { className: 'dsh-collab-guide-icon' },
          icon === undefined ? null : h(icon, { size: 22 })),
        h('span', { className: 'dsh-collab-guide-text' },
          h('span', { className: 'dsh-collab-guide-title' }, props.title),
          props.description === undefined ? null : h('span', { className: 'dsh-collab-guide-description' }, props.description),
          summary.length === 0 ? null : h('span', { className: 'F6Huca_entryDescription' }, summary),
        ),
      )
    }

    function CollabPresetMenuFilter(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      React.useEffect(() => {
        const translatePresetCopy = () => {
          const pairs = [
            [COMPAT.labels.collab, t('preset.collabName')],
            [COMPAT.labels.supervisor, t('preset.supervisorName')],
            ['拥有独立的 .dsh-collab 工作目录、共享的 comm/ 目录和仅本会话可访问的 private/ 目录，并提供经过身份验证的会话间通信工具。', t('preset.collabDescription')],
            ['负责拆解需求、把子任务分派给已登记的功能会话、核验结果并完成交付；不提供任何实现类工具。', t('preset.supervisorDescription')],
          ]
          for (const node of document.querySelectorAll('span, div, p, button')) {
            if (node.children.length !== 0) continue
            const text = node.textContent ?? ''
            const pair = pairs.find(([source]) => text === source)
            if (pair !== undefined && pair[1] !== pair[0]) node.textContent = pair[1]
          }
        }
        const hideLockedPresets = () => {
          translatePresetCopy()
          for (const node of document.querySelectorAll('[role="menuitem"]')) {
            // The collab entry's own dropdown also uses role=menuitem.
            if (node.closest('.dsh-collab-new-menu') !== null) continue
            const text = node.textContent ?? ''
            if (!COMPAT.presetText.test(text)) continue
            node.hidden = true
            node.setAttribute('aria-hidden', 'true')
            node.style.setProperty('display', 'none', 'important')
          }
        }
        hideLockedPresets()
        const observer = new MutationObserver(hideLockedPresets)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => observer.disconnect()
      }, [t])
      return null
    }

    function CollabPresetLockProbe(props) {
      const useSessions = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      const sessions = useSessions(selectSnapshot)
      const values = sessions?.byId?.[props.sessionId]?.projectionValues
        ?? sessions?.projectionsBySession?.[props.sessionId]?.values
      const locked = values?.agentPreset === 'collab' || values?.agentPreset === 'supervisor'
      React.useEffect(() => {
        if (!locked) return undefined
        const root = document.documentElement
        root.setAttribute('data-collab-preset-lock', 'true')
        return () => root.removeAttribute('data-collab-preset-lock')
      }, [locked])
      return h('style', null,
        `html[data-collab-preset-lock="true"] ${COMPAT.modeChip}{display:none!important}`)
    }

    function CollabSupervisorGuideBridge(props) {
      const sessions = props.useSessions(selectSnapshot)
      const main = Object.values(sessions?.byId ?? {})
        .find(summary => (summary.retainedBy?.mainView ?? 0) > 0)
      const preset = main?.projectionValues?.agentPreset
        ?? main?.agentPreset
        ?? main?.preset
        ?? sessions?.projectionsBySession?.[main?.id]?.values?.agentPreset
      React.useEffect(() => {
        const chip = document.querySelector('button[class*="_seat"]')?.textContent ?? ''
        const enabled = preset === 'supervisor' || chip.includes('超级会话') || chip.includes('Supervisor')
        props.setSupervisorGuide(enabled)
        return () => props.setSupervisorGuide(false)
      }, [preset, main?.id])
      return null
    }

    return {
      __test: { isCollabSummary, isSupervisorSessionSummary, parseBasePromptCommand, COMPAT, boardCounts, normalizePanelValue },
      inject: ['slots', 'locale', 'uiWorkspace', 'sessions', 'remote', 'remote.commands', 'remote.collabAuth', 'uiConversation', 'layout', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'collab-sessions: dictionaries')
        const authUnavailable = { ok: false, error: { code: 'collab-auth-unavailable', message: 'Collaboration authorization Remote is not loaded' } }
        const authPanel = {
          list: async () => ctx.remote.collabAuth === undefined ? authUnavailable : ctx.remote.collabAuth.list(),
          authorize: async (a, b) => ctx.remote.collabAuth === undefined ? authUnavailable : ctx.remote.collabAuth.authorize(a, b),
          revoke: async (a, b) => ctx.remote.collabAuth === undefined ? authUnavailable : ctx.remote.collabAuth.revoke(a, b),
        }
        const callPanel = (sessionId, operation, args) => {
          const auth = ctx.remote.collabAuth
          if (auth === undefined) return Promise.resolve(authUnavailable)
          const payload = args ?? {}
          if (operation === 'board' && typeof auth.board === 'function') return auth.board(sessionId)
          if (operation === 'link' && typeof auth.link === 'function') {
            return auth.link(sessionId, String(payload.worker ?? ''), JSON.stringify(payload.payload ?? {}))
          }
          if (operation === 'unlink' && typeof auth.unlink === 'function') {
            return auth.unlink(sessionId, String(payload.worker ?? ''))
          }
          if (operation === 'pin' && typeof auth.pin === 'function') {
            return auth.pin(sessionId, String(payload.worker ?? ''))
          }
          if (operation === 'live' && typeof auth.live === 'function') {
            return auth.live(sessionId, String(payload.worker ?? ''))
          }
          if (operation === 'baseGet' && typeof auth.baseGet === 'function') return auth.baseGet(sessionId)
          if (operation === 'baseSet' && typeof auth.baseSet === 'function') {
            return auth.baseSet(sessionId, String(payload.value ?? ''))
          }
          return auth.panel(sessionId, operation, JSON.stringify(payload))
        }

        const panelCommand = async (sessionId, operation, args) => {
          try {
            const result = await callPanel(sessionId, operation, args)
            if (result === undefined || result.ok !== true) return result
            return {
              ok: true,
              value: { result: { kind: 'success', text: result.value } },
            }
          } catch (error) {
            return {
              ok: false,
              error: { code: 'collab-panel', message: error instanceof Error ? error.message : String(error) },
            }
          }
        }

        const mainSessionPreset = () => {
          const snapshot = ctx.sessions?.list?.getSnapshot?.()
          if (snapshot === undefined) return undefined
          const main = Object.values(snapshot.byId ?? {})
            .find(session => (session.retainedBy?.mainView ?? 0) > 0)
          return main?.projectionValues?.agentPreset
        }
        const originalOpenWorkspace = typeof ctx.uiWorkspace.openWorkspace === 'function'
          ? ctx.uiWorkspace.openWorkspace.bind(ctx.uiWorkspace)
          : undefined
        if (originalOpenWorkspace !== undefined) {
          const openWorkspacePreservingPreset = (workspaceId, beforeOpen, options) => {
            if (options === undefined) {
              const preset = mainSessionPreset()
              if (preset === 'collab' || preset === 'supervisor') {
                return originalOpenWorkspace(workspaceId, beforeOpen, { agentPreset: preset })
              }
            }
            return originalOpenWorkspace(workspaceId, beforeOpen, options)
          }
          ctx.uiWorkspace.openWorkspace = openWorkspacePreservingPreset
          ctx.effect(() => () => {
            if (ctx.uiWorkspace.openWorkspace === openWorkspacePreservingPreset) {
              ctx.uiWorkspace.openWorkspace = originalOpenWorkspace
            }
          }, 'collab:workspace-switch-preset')
        }

        const start = (preset = 'collab') => {
          try {
            // The navigation service targets the current Session's Workspace,
            // then the recent Workspace, exactly like the New Session button.
            const agentPreset = preset === 'supervisor' ? 'supervisor' : 'collab'
            ctx.uiWorkspace.startSession(undefined, { agentPreset })
          } catch (error) {
            console.error('[collab-sessions] could not start a collab session:', error)
            throw error
          }
        }

        ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
          name: 'sidebar.session.action',
          id: 'collab-sessions',
          order: 5,
          locale: NS,
          inject: () => ({
            translate: ctx.locale.bind(NS),
            start,
          }),
        }, CollabNewSessionControls))

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'collab-copy-title',
          order: 50,
          locale: NS,
        }, CollabCopySessionAction))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'collab-copy-title',
          order: 500,
          locale: NS,
        }, CollabCopySessionMenuItem))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'collab-copy-session-styles',
        }, CollabCopySessionStyles))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'collab-auth',
          order: 20,
          label: () => ctx.locale.bind(NS)('panel.label'),
        }, CollabAuthIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'collab-auth',
          locale: NS,
          inject: () => ({ auth: authPanel }),
        }, CollabAuthPanel))

        let supervisorGuide = false
        let tabTypeDisposers = []
        const registerTabTypes = (withGuide) => {
          for (const dispose of tabTypeDisposers.splice(0)) dispose()
          const t = ctx.locale.bind(NS)
          const taskGuide = withGuide
            ? [{ id: 'tasks', title: () => t('board.tasksTitle'), description: () => t('board.tasksGuide'), order: 20, icon: IconChecklistOutlineRegular }]
            : undefined
          const workerGuide = withGuide
            ? [{ id: 'workers', title: () => t('board.workersTitle'), description: () => t('board.workersGuide'), order: 21, icon: IconUserOutlineRegular }]
            : undefined
          tabTypeDisposers = [
            ctx.sidebarRightTabs.register({
              id: BOARD_TAB_ID,
              kind: BOARD_TAB_KIND,
              priority: 'builtin',
              title: () => t('board.tasksTitle'),
              guide: taskGuide,
            }),
            ctx.sidebarRightTabs.register({
              id: WORKERS_TAB_ID,
              kind: WORKERS_TAB_KIND,
              priority: 'builtin',
              title: () => t('board.workersTitle'),
              guide: workerGuide,
            }),
          ]
        }
        ctx.effect(() => {
          registerTabTypes(false)
          return () => { for (const dispose of tabTypeDisposers.splice(0)) dispose() }
        }, 'collab-sessions: supervisor tab types')
        const setSupervisorGuide = (enabled) => {
          if (supervisorGuide === enabled) return
          supervisorGuide = enabled
          registerTabTypes(enabled)
        }

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: BOARD_TAB_ID,
          locale: NS,
          inject: () => ({
            mode: 'tasks',
            panel: (sessionId, operation, args) => callPanel(sessionId, operation, args),
            openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
            openWorkers: (sessionId) => ctx.sidebarRight.openTab(WORKERS_TAB_KIND, { params: { sessionId } }),
          }),
        }, SupervisorBoardTab))

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: WORKERS_TAB_ID,
          locale: NS,
          inject: () => ({
            mode: 'workers',
            panel: (sessionId, operation, args) => callPanel(sessionId, operation, args),
            openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
          }),
        }, SupervisorBoardTab))

        for (const key of [BOARD_TAB_ID, WORKERS_TAB_ID]) {
          ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key,
            locale: NS,
          }, CollabBoardTabTitle))
        }

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'collab-guide-card-styles',
        }, CollabGuideStyles))

        for (const key of [BOARD_TAB_ID, WORKERS_TAB_ID]) {
          ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({
            name: 'sidebar.right.tab.guide.entry',
            key,
            locale: NS,
            inject: sessionId => ({
              sessionId,
              loadSummary: () => callPanel(sessionId, 'board'),
            }),
          }, CollabGuideCard))
        }

        ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
          name: 'conversation.hero.options',
          id: 'collab-preset-lock',
          order: 100,
        }, CollabPresetLockProbe))

        ctx.effect(
          () => ctx.uiConversation.events.register(collabAuthRefusedDefinition),
          'collab-sessions: authorization-refusal turn data',
        )

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'collab-auth-refused',
          order: 25,
          locale: NS,
          inject: () => ({
            openAuth: () => ctx.layout.selectPanel('collab-auth'),
          }),
        }, CollabAuthRefusedTail))

        setBasePromptExecutor((sessionId, line) => {
          const command = parseBasePromptCommand(line)
          if (command === null) return Promise.resolve({ ok: false, error: { code: 'invalid-base', message: 'invalid base prompt command' } })
          if (command.operation === 'baseGet') return panelCommand(sessionId, 'baseGet')
          return panelCommand(sessionId, 'baseSet', { value: command.value })
        })

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'collab-base-prompt',
          locale: NS,
        }, CollabBasePromptEditor))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'collab-supervisor-guide-bridge',
          inject: () => ({ setSupervisorGuide }),
        }, CollabSupervisorGuideBridge))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'collab-preset-menu-filter',
          locale: NS,
        }, CollabPresetMenuFilter))

        setLinkExecutor((sessionId, line) => {
          const match = /^\/collab-link (pin|live|unlink) ([^\s]+)$/u.exec(line)
          if (match === null) return Promise.resolve({ ok: false, error: { code: 'invalid-link', message: 'invalid worker action' } })
          return panelCommand(sessionId, match[1], { worker: match[2] })
        })

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'collab-capability-detail',
          locale: NS,
        }, CollabCapabilityDetailOverlay))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'collab-base-prompt',
          order: 40,
          locale: NS,
        }, CollabBasePromptMenuItem))

      },
    }
  },
})

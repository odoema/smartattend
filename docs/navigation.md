# Navigation rules this app now follows

Short version of the reasoning behind the navigation pass, so it does not get
undone by accident.

## One bar, at most five places

A phone shows four or five destinations comfortably; more than that and the bar
becomes a scroller that hides destinations off-screen with no hint they exist.
The admin area had six (Dashboard, Courses, Timetable, People & settings, Test
lab, Business model) in a horizontally scrolling strip. It now has four in the
bar, and the two that are used once (Test lab, Business model) moved to a Tools
row on the dashboard.

Below 640px that bar is pinned to the bottom of the screen, where a thumb
reaches it, and the page reserves room so nothing hides underneath it.

## Every page says where it is

- The window title changes per route (`SmartAttend · Reports`), so history, tab
  lists and screen readers identify the page.
- Moving between pages moves focus to the new heading. Without that, a keyboard
  or screen-reader user stays anchored where the link used to be. It only happens
  on real navigation, never on the 4-second register refresh, or it would steal
  focus mid-task.
- The current destination carries `aria-current="page"`.
- An unknown address says so instead of quietly showing the dashboard.

## What is deliberately not here

No hamburger menu, no drawer, no nested sidebar: with four destinations and one
level of course tabs, those add taps and hide the map. Android back, browser
back and deep links all keep working because navigation stays in the URL hash.
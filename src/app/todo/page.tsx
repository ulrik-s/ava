/**
 * Server-wrapper för /todo — enad "Att-göra med datum/tid"-vy som ersätter
 * den traditionella kalendern. Renderar TodoClient som hämtar todo.list
 * (aggregerar tasks + calendar-events).
 */

import TodoClient from "./_client";

export default function TodoPage() {
  return <TodoClient />;
}

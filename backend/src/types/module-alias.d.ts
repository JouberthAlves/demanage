declare module 'module-alias' {
  const moduleAlias: {
    addAlias: (alias: string, target: string) => void;
  };
  export default moduleAlias;
}

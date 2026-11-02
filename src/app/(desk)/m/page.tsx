import { notConnectedRoute } from '../not-connected';

const route = notConnectedRoute('m');
export const generateMetadata = route.generateMetadata;
export default route.Page;
